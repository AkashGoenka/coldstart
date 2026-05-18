# JVM same-package short-name spec

## Goal

Java/Kotlin types in the same package can be referenced without an `import`
statement — they resolve implicitly. Today the extractor only collects
explicit `import_declaration` nodes, so same-package references produce no
edge. Goal: emit those edges. Hard halves (JPA, DI by interface, `@Bean`)
stay deferred per `docs/resolver-specs.md`.

## Mechanism — extractor side (the only side that needs to change)

The current `resolveJava` already takes FQCNs. It does not need to know
about same-package semantics. The cleanest shape is to make the extractor
qualify bare type names into FQCNs before pushing them into `imports[]`:

```
imports.push(`${packageName}.${bareTypeName}`)
```

The resolver then matches it against the existing FQCN index. If the FQCN
doesn't exist (e.g. the bare name is `String` or anything in `java.lang`),
the lookup misses and no edge is emitted — same null behavior as today.

## Detection — which AST nodes count as type references

Walk top-level type declarations and collect bare type identifiers from:

- **`superclass`** (extends clause) — strongest signal
- **`super_interfaces`** (implements clause)
- **`field_declaration`** types
- **`formal_parameter`** types (method + constructor params)
- **method `return_type`**
- **`object_creation_expression`** (`new Foo()`)
- **`annotation`** / **`marker_annotation`** name — `@Foo` on classes,
  fields, methods, params. Strongest signal in Spring/JPA repos.

Skip for v1: type casts, `instanceof`, local variable declarations,
generic args inside generics.

A bare identifier qualifies as a "type reference" iff:
1. It's a single identifier (no dot).
2. It starts with an uppercase letter (Java naming convention).
3. It is NOT shadowed by an explicit `import` — see below.
4. It is NOT in the `java.lang` shortlist (`String`, `Object`,
   `Integer`, `Long`, `Boolean`, `Double`, `Float`, `Character`, `Byte`,
   `Short`, `Void`, `Number`, `Math`, `System`, `Thread`, `Runnable`,
   `Exception`, `RuntimeException`, `Throwable`, `Error`, `Class`,
   `Enum`, `Iterable`, `Comparable`, `CharSequence`, `StringBuilder`,
   `StringBuffer`).

Step 4 prevents false hits when a same-package file is accidentally named
`String.java`. Keep the shortlist minimal — anything not on it just
misses the FQCN index lookup and falls through to null.

## Shadowing — dedupe against explicit imports (load-bearing)

Java resolution rule: a single-type import (`import org.slf4j.Logger;`)
beats same-package. If we don't dedupe, a file that imports a
third-party `Logger` and ALSO has a same-package `Logger.java` will
emit a spurious edge to the same-package file (the actual reference
resolves to the third-party one).

Concrete dedupe:

1. Before walking the body, collect explicit import basenames:
   `importedBasenames = new Set(imports.map(fqcn => fqcn.split('.').pop()))`
2. When a bare reference passes steps 1, 2, 4 above, also require
   `!importedBasenames.has(bareName)` before qualifying.

This makes the explicit import the authoritative resolution (it'll hit
the FQCN index if the imported type is in-project, miss if third-party
— either way, the same-package qualification doesn't fire).

## Why third-party packages aren't a risk

The FQCN index is built from `fileIdSet` — only files coldstart walks.
Third-party libraries (jars, vendored deps) are never indexed. A bare
reference qualified as `com.example.user.Logger` either hits an
in-project file (correct edge) or misses (no edge). We can't emit
spurious edges to third-party code because we don't have that code's
files to point at. Blast radius is bounded to false negatives.

## Kotlin

Identical mechanism — Kotlin shares Java's package semantics and FQCN
syntax. The same AST-node names exist in tree-sitter-kotlin
(`class_declaration`, `function_declaration` parameters/return,
`property_declaration` types). Verify node names against the grammar
before implementing; do not assume.

## Edge cases

- **`package-info.java`** — has no type declarations, so the walker
  emits nothing. Safe by construction.
- **Nested classes** (`Outer.Inner` referenced in same package) — bare
  `Inner` referenced inside `Outer`'s file is intra-file, handled by
  existing symbol-tree code. Cross-file `Outer.Inner` references are
  dotted and already handled by the resolver's static/inner fallback
  (the existing `lastDot` trim).
- **Files in default package** (no `package_declaration`,
  `packageName === ''`) — skip same-package emission entirely; the
  qualified name would be `.TypeName` which won't hit the FQCN index.
- **Test files** — same-package emission applies to them too;
  intentional (test files reference production types in their package).

## Validation

**Unit tests — add in-repo fixtures (agent adds these):**

`tests/fixtures/java/same-package/`:
- `com/example/svc/UserService.java` — extends `BaseService`, uses
  `UserRepository` field, returns `UserDto`, annotated `@Service`
- `com/example/svc/BaseService.java`
- `com/example/svc/UserRepository.java`
- `com/example/svc/UserDto.java`
- `com/example/svc/Service.java` — same-package annotation type, for
  the annotation-emission case
- `com/example/svc/Logger.java` — same-package class with the SAME
  name as a (fake) third-party type, for the shadowing case
- `com/example/svc/ShadowedClient.java` — imports
  `org.example.third_party.Logger` and references `Logger` in the body.
  Must NOT emit an edge to same-package `Logger.java` (explicit import
  wins per Java spec).
- `com/example/other/Unrelated.java` — used to verify cross-package
  references still need an import (negative case)

`tests/fixtures/kotlin/same-package/` — mirror structure in Kotlin
(including the shadowing case with a top-level Kotlin class).

Test assertions:
- `UserService` emits **4** same-package edges: BaseService,
  UserRepository, UserDto, and `Service` (annotation).
- `UserService` does NOT emit an edge to `Unrelated` (cross-package
  isolation preserved).
- `ShadowedClient` does NOT emit a same-package edge to `Logger.java`
  despite both being in `com.example.svc` — explicit import shadows.
  Its `imports[]` should contain the third-party FQCN unchanged (which
  will then miss the FQCN index, resulting in 0 edges from this file —
  the correct outcome).
- Existing explicit-import tests still pass (no double-emit, no
  regression on cross-package imports).
- Default-package file (no `package_declaration`) emits no same-package
  edges.

**Local probe (post-merge, human runs):**

```
node dist/index.js --probe --root ~/benchmark/repos/jmri --no-daemon --quiet
```

jmri JVM resolution today is ~0%. Expected post-fix: meaningfully
non-zero. Read the `java` block under `edgesBySpecifier` /
`resolvedRatio`. No hard target — the goal is "JVM stops being a
black hole." Spot-check a handful of newly-resolved edges to confirm
they're real same-package refs and not noise.

## Out of scope (do not implement in this PR)

- JPA relationships (`@OneToMany`, `@ManyToOne` — *target* resolution
  through annotation arguments, not the annotation type itself)
- DI by interface (`@Autowired` field typed as an interface, where the
  intended edge points at the concrete implementation, not the interface)
- `@Bean` factory methods (method-return-type → caller wiring)
- Spring `@ComponentScan` glob expansion
