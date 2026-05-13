# C# / .NET Resolver Extension — Spec

Status: **research / proposal**. Not implemented.

## Problem

The current C# resolver (`src/indexer/resolvers/csharp.ts`) only follows `using` directives, which map a namespace to "any .cs file in the matching directory." That captures lexical namespace references but misses every relationship .NET expresses through **runtime conventions**:

1. **DI registrations** — `services.AddScoped<IFoo, Foo>()` wires an interface to an implementation. Consumers inject `IFoo` (often resolved via a `using` to the interface's namespace), but the binding to `Foo` is invisible to a `using`-only resolver. This is the .NET equivalent of Spring `@Autowired` or Rails `has_many` — a name resolved at runtime via name→type mapping the import graph never sees.
2. **MVC / Razor / minimal-API routing** — `[Route("api/users")]`, `[HttpGet("{id}")]`, `MapGet("/x", handler)`. The link between a URL or action name and a controller method is invisible without parsing the attribute. Views are loaded by convention (`Views/{Controller}/{Action}.cshtml`).
3. **EF Core navigation properties** — `public IReadOnlyCollection<OrderItem> OrderItems { get; }` on `Order` implies a relationship to `OrderItem`. Same shape as Rails `has_many` / JPA `@OneToMany`.
4. **Partial classes** — `public partial class Foo` declared in two `.cs` files. Both files belong together (designer-file + handwritten, source-generator output + hand code, MAUI/WPF `.xaml.cs` + view). Today they share nothing in the graph unless one happens to `using` the other.
5. **Razor `_ViewImports.cshtml`** — auto-imports namespaces and tag helpers into every sibling `.cshtml` under the folder. Should yield edges from each `.cshtml` to the imported namespaces (same as `using`).
6. **Configuration binding** — `Configuration.GetSection("Logging").Get<LogOptions>()` and `services.Configure<LogOptions>(Configuration.GetSection("Logging"))` link an Options POCO to an `appsettings.json` section.

The shape of the fix mirrors the Rails work in `src/indexer/extractors/ruby.ts` (`RAILS_ASSOCIATION_METHODS`, route extraction, controller↔view edges in `graph.ts`): **walk the AST for known surface forms, resolve names against a deterministic index, emit synthetic edges**.

This document scopes only what coldstart should index. Coldstart is an evidence ranker, not a classifier — we add edges, we don't add categorical "DI binding" labels on the symbol.

## Convention surface forms (tree-sitter-c-sharp)

All node types verified against the grammar version shipped via `tree-sitter-c-sharp` ≥ 0.21. Where the grammar disagrees across versions, the POC falls back to text matching on the parent invocation.

### 1. DI registration

Tree shape for `services.AddScoped<IFoo, Foo>()`:

```
invocation_expression
├── member_access_expression          # services.AddScoped
│   ├── identifier "services"         # receiver
│   └── generic_name                  # method (when generic)
│       ├── identifier "AddScoped"
│       └── type_argument_list
│           ├── identifier "IFoo"     # or generic_name / qualified_name
│           └── identifier "Foo"
└── argument_list                     # may be empty for 2-arg generic form
```

Detection rule:

- `invocation_expression` whose method is one of: `AddScoped`, `AddSingleton`, `AddTransient`, `TryAddScoped`, `TryAddSingleton`, `TryAddTransient`, `TryAddEnumerable`.
- With either:
  - **two-arg generic**: `type_argument_list` has 2 children → emit edge `interface → impl` (and impl `using`-reachable from current file).
  - **one-arg generic + lambda/factory**: `AddScoped<IFoo>(sp => ...)` — extract the `IFoo` but leave impl unresolved.
  - **non-generic + typeof**: `AddScoped(typeof(IFoo), typeof(Foo))` — same resolution.
  - **single-generic concrete**: `AddSingleton<Foo>()` — register a concrete; the only edge is the implicit "file declaring `Foo` is referenced from registration site," which we already capture via the `using` for `Foo`'s namespace, so **skip** to keep edge count honest.

The interface and impl names are short names (e.g. `IFoo`, not `Acme.IFoo`). Resolution to a file uses an **FQCN index** built once per repo:

- For every `class_declaration` / `interface_declaration` / `record_declaration` / `struct_declaration`, key by `(namespace, name)` and short `name`. Namespace comes from the enclosing `namespace_declaration` (block or file-scoped).
- On a hit, prefer matches whose namespace is reachable via a `using` in the calling file or the file declaring the type. If multiple matches, emit edges to all (low confidence, but rare in practice).

### 2. Attribute routing

Tree shape for `[Route("api/users")]` or `[HttpGet("{id}")]`:

```
attribute_list
└── attribute
    ├── identifier "Route" / "HttpGet" / "ApiController" / "Authorize"
    └── attribute_argument_list
        └── attribute_argument
            └── string_literal "api/users"
```

Indexed attribute names (configurable stop/allow list):

- **Routing**: `Route`, `HttpGet`, `HttpPost`, `HttpPut`, `HttpPatch`, `HttpDelete`, `Area`, `ApiController`.
- **Authorization**: `Authorize`, `AllowAnonymous` — symbol-level metadata, not an edge.
- **Filters/conventions**: `ValidateAntiForgeryToken`, `Produces`, `Consumes` — metadata only.

Edge emission:

- Controller class with `[Route(...)]` ⇒ no immediate edge, but record the prefix.
- Each `[HttpGet("path")]` method ⇒ store `(verb, fullPath, controllerSymbolId, methodSymbolId)` in a route table.
- **View-by-convention edge** (MVC, not API): if the controller method body contains `View()` or `View("Name", ...)`, emit edge `controllerMethodFile → Views/{Controller}/{Action|Name}.cshtml`. Same pattern as `addRailsControllerViewEdges` in `graph.ts`.

### 3. EF Core navigation properties

Tree shape for `public IReadOnlyCollection<OrderItem> OrderItems { get; }`:

```
property_declaration
├── modifier "public"
├── generic_name                      # type
│   ├── identifier "IReadOnlyCollection"
│   └── type_argument_list
│       └── identifier "OrderItem"
├── identifier "OrderItems"
└── accessor_list ...
```

Detection rule:

- Property declarations on a class. Type is either:
  - A bare `identifier` whose name resolves to another class in the FQCN index, and the declaring class is in a path matching `**/Domain/**`, `**/Entities/**`, `**/Models/**`, or `**/AggregatesModel/**` (entity-folder gate — analogous to Rails `app/models/` gate).
  - A generic collection (`ICollection<T>`, `IReadOnlyCollection<T>`, `List<T>`, `HashSet<T>`, `IEnumerable<T>`) whose `T` resolves to another class in the same folder gate.
- Skip primitives (`string`, `int`, `bool`, `Guid`, `DateTime`, `decimal`, `double`, `float`, `byte`, `short`, `long`, `char`, `object`) and nullable wrappers.
- Skip framework types via the stoplist.
- Emit edge `entityFile → relatedEntityFile`.

False positives are acceptable on this gate — entities referencing each other for non-EF reasons still constitute a "files-go-together" signal.

### 4. Partial classes

Tree shape — same `class_declaration` node, but with a `partial` modifier:

```
class_declaration
├── modifier "public"
├── modifier "partial"
├── identifier "Foo"
└── ...
```

Detection rule:

- Group all `class_declaration` nodes with `partial` modifier by `(namespace, name)`.
- For every group of ≥ 2 files, emit a complete bidirectional edge between all pairs.
- Implementation: post-pass at graph build time (similar to `addRailsControllerViewEdges`), not in the per-file extractor.

### 5. Razor `_ViewImports.cshtml`

Razor isn't C# but cohabits the project. The grammar `tree-sitter-c-sharp` won't parse `.cshtml` correctly. Two options:

- **Regex extractor** (preferred, low effort) — `@using Acme.Web.Models` lines yield imports. `@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers` is stoplisted (framework).
- For each `.cshtml` under a folder, prepend the imports from the nearest `_ViewImports.cshtml` walking up to the project root.

This is structurally similar to how GlobalUsings.cs files (e.g. `/tmp/eshop/src/Ordering.Domain/GlobalUsings.cs`) need to be processed — those should also be applied as a per-project preamble.

### 6. Configuration binding

Detection rule:

- `invocation_expression` whose method is `Get`, `Bind`, or whose receiver chain ends in `.GetSection("X").Get<T>()` / `.GetSection("X").Bind(obj)`.
- Also `services.Configure<T>(config.GetSection("X"))`.
- Emit edge `callingFile → T's declaring file` AND record `("X", T)` in an appsettings-binding table.
- If an `appsettings.json` exists at the project root and has a key `"X"`, also emit edge `callingFile → appsettings.json`.

This convention is comparatively low-yield (most consumers of Options also `using` the namespace it lives in, so the FQCN already lands), but cheap once the FQCN index is built.

## Stoplist

Drop any FQCN whose namespace starts with:

- `System.`
- `Microsoft.AspNetCore.`
- `Microsoft.Extensions.`
- `Microsoft.EntityFrameworkCore.` (except for `DbContext` subclassing detection — kept as metadata)
- `Microsoft.Identity.`
- `Newtonsoft.Json.`, `System.Text.Json.`
- `Serilog.` (only when serilog is a dependency, not the indexed repo — detect via presence of a `Serilog.csproj` under the indexed root).
- `Xunit.`, `NUnit.`, `Moq.`, `FluentAssertions.`
- `Microsoft.Maui.`, `CommunityToolkit.Mvvm.` (MAUI / view-model framework)

Also drop short type names: `Task`, `Task<T>`, `ValueTask`, `IActionResult`, `ActionResult`, `IEnumerable`, `IQueryable`, `IList`, `ICollection`, `IReadOnlyCollection`, `IReadOnlyList`, `IDictionary`, `IReadOnlyDictionary`, `HashSet`, `List`, `Dictionary`, `Span`, `ReadOnlySpan`, `Memory`, `ReadOnlyMemory`, `Nullable`.

## Edge cases

- **Generic registrations**: `AddScoped(typeof(IRepo<>), typeof(Repo<>))` — emit edge between the open generic short names, same as closed generics.
- **Factory lambdas**: `AddScoped<IFoo>(sp => new Foo(sp.GetRequiredService<IBar>()))` — body of the lambda is `object_creation_expression` `new Foo(...)`. Walk one level into the lambda and treat any `new T(...)` as a candidate impl. Cap at depth 1; we are not a flow analyzer.
- **Conditional registration**: `#if`-guarded `AddScoped`s appear in the AST verbatim (tree-sitter doesn't evaluate the preprocessor). Emit edges for all branches; over-edging is cheaper than missing.
- **`AddDbContext<T>`**: registers a `DbContext`. Emit edge `caller → T's file`. Don't try to resolve the per-provider config method (`UseNpgsql`, etc.).
- **`AddIdentityCore<T>().AddRoles<TRole>().AddEntityFrameworkStores<TContext>()`**: chained generic invocations on the result of `AddIdentityCore`. The AST is a left-leaning chain of `invocation_expression`s — walk each and emit any 1-arg generic concrete edges as best-effort.
- **Source generators**: emit synthetic `.cs` into `obj/`. Out of scope — `obj/` is already ignored by the walker. Where the generator emits a `partial class` and the hand-written half is indexed, the partial-class merge captures it.
- **Top-level statements (`Program.cs`)**: there's no enclosing class for the `services.AddScoped<>` call. Resolution proceeds the same way; the calling site is the file, not a class symbol.
- **Same short name in two namespaces**: emit edges to all candidates. Acceptable — neighbor signals are robust to ambiguity, and the user-visible ranking already de-duplicates.
- **Anonymous DI registration via extension method**: `services.AddMyFeature()` where `AddMyFeature` is itself a `static class FooExtensions` containing the actual `AddScoped<...>`s. Out of scope as a transitive lookup; the resolver follows the `using` to `FooExtensions`, and the user gets one hop further by inspecting that file.

## Integration sketch

### `src/indexer/extractors/csharp.ts`

- Add `attributes: AttributeNode[]` and `propertyDecls: PropertyDeclNode[]` to `CSharpParseResult`.
- Walk `attribute_list` children of each `class_declaration` / `method_declaration` and record `(name, args)`.
- Walk `property_declaration` children of each `class_declaration` and record `(name, typeText, genericArgs)`.
- Walk `invocation_expression` whose method matches the DI registration names, and record the type-argument-list short names as `diRegistrations: [{ kind, ifaceName, implName, line }]`.
- Mark partial classes via `isPartial: boolean` on each class symbol.

### `src/indexer/resolvers/csharp.ts`

- After current namespace-as-path resolution: add a second-pass FQCN index built once per `fileIdSet` (cached in the same `WeakMap`). Key: short name → list of `fileId`s declaring a type by that name. Resolution: short name → preferred file (one in the same namespace tree as caller wins; fallback to first).
- New exported helper `resolveCSharpShortName(name, fromFile, fileIdSet)` reused by the synthetic-edge pass.

### `src/indexer/graph.ts`

- Add `addCSharpDiEdges(...)` walking each file's `diRegistrations`, resolving via `resolveCSharpShortName`, emitting bidirectional iface↔impl edges.
- Add `addCSharpPartialClassEdges(...)` — same shape as `addRailsControllerViewEdges`. Group by `(namespace, name, isPartial=true)`, emit clique edges.
- Add `addCSharpControllerViewEdges(...)` — for each `Controller` class with a `View()` call returning name `N`, emit edge to `**/Views/{ControllerShort}/{N or ActionName}.cshtml`.

### Razor (`.cshtml`)

- New extractor `src/indexer/extractors/razor.ts` (regex-based). Emits imports for `@using`, `@inherits`, `@inject` lines.
- Resolver: reuse C# resolver — `@using Foo.Bar` resolves identically to `using Foo.Bar`.

### GlobalUsings

- During parse, if filename matches `GlobalUsings.cs` (case-insensitive) and its directory is a project root (contains a `*.csproj` sibling), record all `using_directive`s as a project-level preamble. At graph-build time, every other `.cs` file in that project inherits these imports.

## Prioritization within .NET

If implemented incrementally, ship in this order. Each step is independently useful.

1. **Partial classes** — highest signal-to-effort ratio. Detection is trivially `partial class Name` grouping. No name resolution involved. Catches MAUI view-model splits, source-generator pairs, and designer-file patterns. Zero false positives.
2. **DI registrations** (`AddScoped`/`AddSingleton`/`AddTransient`) — the .NET equivalent of `@Autowired`. Mid-effort (needs the FQCN index, which is also a prerequisite for #3 and #6). Pays off on every ASP.NET Core repo.
3. **Controller→View edges** (MVC) — small extension once the C# extractor sees attribute lists. Razor parsing is purely path-based for this edge (no need to parse the `.cshtml`).
4. **EF nav properties** — useful only on domain-heavy repos. Folder-gated, so cheap when the gate doesn't match. Defer behind #1–#3.
5. **Razor `_ViewImports.cshtml` / `GlobalUsings.cs`** — small surface, pays off on Razor-heavy apps.
6. **Configuration binding** — lowest yield, defer indefinitely unless a benchmark prompt explicitly demands "what is bound to this appsettings section."

Routing attribute paths (`[Route("api/x")]`) are recorded but **not turned into edges** in step 3. They are metadata on the controller symbol, surfaced through `get-structure`. Edges would require a separate "URL → handler" tool, which is out of scope for the current ranker.

## What we deliberately do not do

- No reflection-style "find all classes implementing `IHandler<TRequest, TResponse>`" — MediatR/CQRS patterns wire handlers by interface generic args. Resolving these requires a generic-aware FQCN index and crosses into classifier territory. Defer until a benchmark prompt proves the gap matters.
- No analysis of `IConfigureOptions<T>`, `IPostConfigureOptions<T>`, or fluent builder chains (`.AddHttpClient<TClient, TImpl>()`) beyond the basic generic-two-arg shape.
- No XAML / .xaml file parsing (MAUI / WPF). The corresponding `.xaml.cs` half is already captured by the partial-class rule.
- No source-generator output (`obj/` is walker-skipped).
- No symbol-level role tags ("DI binding," "controller action," "EF entity"). Coldstart is evidence, not classification — see the project memory on this.
