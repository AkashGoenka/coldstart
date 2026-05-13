# PHP resolver: Laravel + Symfony convention references

Status: research spec. No production code changes proposed in this document.

## Why

`src/indexer/resolvers/php.ts` and `src/indexer/extractors/php.ts` cover only
explicit references: `use X\Y;`, `require '../foo.php'`, PSR-4 autoload via the
nearest `composer.json`. That misses the majority of inter-file references in
Laravel and Symfony apps, which use convention-over-configuration runtime
binding the way Rails does (cf. the `feedback_implicit_reference_resolver_gap`
memory). Concrete coverage gap measured on `/tmp/monica-laravel` (a real Laravel
12 app):

- 200+ `Eloquent` relationships (`hasMany(User::class)`) appear with no edge to
  the related model unless the FQCN is also `use`'d in the file. In Monica's
  `Account.php`, related models are not `use`'d because `::class` resolves at
  runtime — coldstart sees zero outgoing edges from `Account` to `User`,
  `Template`, `Module`, `GroupType`, `Pronoun`, `Gender`, etc.
- `routes/web.php` references 100+ controllers via `[FooController::class, 'index']`.
  These ARE `use`'d at the top (3000+ lines of `use` statements), so explicit-edge
  coverage here is accidentally good — but route-grouping / sub-resource
  semantics are lost.
- `app('SomeService')`, `$this->app->bind(...)`, `resolve(IFoo::class)`: ~10–50
  call sites per Monica subdomain, all invisible to coldstart today.
- Symfony: in `/tmp/symfony-demo`, `BlogController::render('blog/post_show.html.twig')`
  has no edge to `templates/blog/post_show.html.twig`. `#[Route('/admin/post')]`
  attribute argument is unparsed; `config/services.yaml` `App\:` resource glob
  is unparsed.

This spec follows the same pattern as the Rails work in
`src/indexer/extractors/ruby.ts` (RAILS_ASSOCIATION_METHODS, line 82;
extractRoutesImports, line 115): detect a known DSL surface form, map to a
target file via deterministic naming convention, emit a synthetic
file-level edge from the graph builder.

## Priorities (high → low)

Ranked by signal-per-line-of-code observed in Monica + symfony-demo. Ship in
this order; stop when ROI drops.

1. **Eloquent relationships** (`hasMany`, `belongsTo`, `hasOne`,
   `belongsToMany`, `morphMany`, `morphTo`). Dense, deterministic, biggest gap.
2. **Blade `@include` / `@extends` / `@component`**. Template directory
   convention is fixed (`resources/views/**`). Already a Laravel-app-flavoured
   gap; trivially decoded.
3. **Symfony Twig `$this->render('foo/bar.html.twig')`**. Same shape as Blade;
   directory convention is `templates/**`.
4. **Symfony `#[Route]` attribute parsing**. Doesn't create file edges directly,
   but lets us synthesise YAML-route → controller edges later.
5. **Symfony `config/services.yaml`** — emit YAML→class edges and parse the
   `App\: resource: '../src/'` glob.
6. **Laravel route facades `Route::get(..., [Controller::class, 'method'])`**.
   Mostly redundant with `use` — already resolved by today's extractor. Keep
   parking unless we want controller-method-level edges later.
7. **Laravel `app(...)` / `resolve(...)` / `$this->app->bind(...)`**. Class-string
   case is easy (`Foo::class`); string-id case (`app('cache.store')`) requires
   the binding registry from service providers and is much harder. Ship the
   class-string case only.
8. **`config('services.stripe.secret')` → `config/services.php`**. Low value,
   defer.
9. **Middleware alias resolution** (`->middleware('auth')` →
   `App\Http\Middleware\Authenticate`). Laravel 11+ removed
   `app/Http/Kernel.php`; aliases now live in `bootstrap/app.php` via
   `->withMiddleware(...)`. Format varies. Defer until prioritised.

## Surface forms

All matched against `tree-sitter-php` named nodes. The convention is to walk the
AST inside class bodies (Eloquent), inside top-level expression statements
(routes), or as PHP attributes (`attribute_list` / `attribute`). For Blade we
do regex over the file content (Blade isn't a tree-sitter grammar and the
directives are unambiguous in practice).

### Laravel — Eloquent relationships

```php
public function comments(): HasMany
{
    return $this->hasMany(Comment::class);            // class-const FQCN
    return $this->hasMany('App\\Models\\Comment');    // string FQCN
    return $this->hasMany(Comment::class, 'fk', 'pk');// extra args ignored
    return $this->belongsTo(User::class);
    return $this->morphMany(Image::class, 'imageable');
    return $this->hasManyThrough(Deployment::class, Environment::class);
    return $this->morphTo();                          // skip — polymorphic
}
```

Node shape (verified against Monica `Account.php`):
- `class_declaration` → `declaration_list` → `method_declaration` → `compound_statement`
- inside the body: `return_statement` → `member_call_expression`
- `member_call_expression.name` (a `name`) text ∈ relationship method set
- `member_call_expression.arguments` → `arguments` → first child:
  - `class_constant_access_expression` whose first child is the class name
  - or `encapsed_string` / `string`

Relationship method set:
```
hasOne, hasMany, hasOneThrough, hasManyThrough,
belongsTo, belongsToMany,
morphOne, morphMany, morphToMany, morphedByMany
```
Skip `morphTo()` (no argument = polymorphic dispatch, can't statically resolve).
Skip relationships whose first arg is not a `Foo::class` or a string literal —
runtime-computed targets exist (e.g. `app(Resolver::class)->modelClass()`)
and we don't try.

Edge target resolution: same as the existing PSR-4 resolver. The class name
extracted (`Comment` or `App\Models\Comment`) is passed back through
`resolvePHP(...)`. For the bare-name case (`Comment::class`), prefix-search the
`use` import list in the same file: if any `use App\Models\Comment` exists,
emit edge to that file. Otherwise treat as unresolved.

Gated to files under `app/Models/` (mirrors the Rails `app/models/` gate at
`ruby.ts:521`). Without this gate, controller methods named `hasMany` (rare but
real in custom DSLs) leak edges.

### Laravel — Blade includes

```blade
@include('partials.header')
@include('partials.header', ['title' => 'x'])
@extends('layouts.app')
@component('mail::message')                            -- vendor namespace
@includeIf('partials.maybe')
@includeWhen($cond, 'partials.maybe')
@includeFirst(['custom.header', 'partials.header'])    -- array form
```

Resolution:
- Strip vendor namespace (`mail::message`): `mail::message` → look in
  `resources/views/vendor/mail/message.blade.php` if it exists, else mark
  unresolved (vendor publishes overrides; the bare reference may be a vendor
  package we don't index).
- Plain dotted path `partials.header` → `resources/views/partials/header.blade.php`.
- `resources/views/` is fixed by Laravel convention; do not look up `config/view.php`.
- File is the nearest ancestor `resources/views/` from the `.blade.php` file's
  composer dir (so we follow the same walk-up pattern as PSR-4).

`@includeFirst([...])`: emit edge to the first path that resolves to an existing
file, like Laravel does at runtime. If multiple resolve, prefer the first
(static order matches runtime order).

Extraction strategy: regex over file content. Tree-sitter-php does not parse
Blade directives; tree-sitter-blade is not in the dep set. Regex:
```
/@(?:include|includeIf|includeWhen|includeFirst|includeUnless|extends|component)\s*\(\s*(['"])([^'"]+)\1/g
```
plus a separate handler for the `[...]` array form of `@includeFirst`.

### Laravel — Service container

```php
app(Foo::class)               // helper, class-const → resolvable
app('cache.store')            // helper, string id → need binding registry
App::make(Foo::class)
resolve(Foo::class)
$this->app->bind(IFoo::class, Foo::class)
$this->app->singleton(...)
```

Surface form:
- `function_call_expression` where `name` is `app` or `resolve`, argument is a
  `class_constant_access_expression`.
- `member_call_expression` where receiver text is `App` (or `\Illuminate\Support\Facades\App`)
  and method is `make`.
- `member_call_expression` on `$this->app` with method ∈ {`bind`, `singleton`,
  `instance`, `scoped`}. First arg = abstract, second arg = concrete; emit edge
  to BOTH targets (we want to find both when the user searches).

Stoplist: skip framework-internal abstracts (`'cache'`, `'config'`,
`'db'`, `'log'`, `'view'`, `'router'`, `'session'`, `'translator'`,
`'validator'`, `'queue'`, `'cookie'`, `'mailer'`, `'auth'`, `'auth.driver'`,
`'redis'`, `'files'`, `'hash'`, `'encrypter'`, `'broadcast'`, `'events'`,
`'request'`, `'url'`, `'redirect'`).

### Laravel — Route facade (deferred)

`Route::get('/x', [Ctrl::class, 'method'])` already works because `Ctrl` is
`use`'d at the top of the routes file. The case that fails is when route
groups dynamically determine controller via string ID. Skip in v1.

### Symfony — Route attribute

```php
#[Route('/users', name: 'user_index', methods: ['GET'])]
public function index(): Response {...}
```

Node shape (verified against `symfony-demo` `BlogController.php`):
- `attribute_list` → `attribute` with `name` text `Route` (resolved by following
  the `use Symfony\Component\Routing\Attribute\Route;` import at the file top).
- First positional argument is the URL path.

This does not produce a file edge by itself (the controller already lives in
its own file). It enables a future YAML-route → controller edge from
`config/routes.yaml` `resource:` entries. Defer the edge; emit a symbol record
tagging the method as a route handler.

### Symfony — Twig render

```php
return $this->render('blog/post_show.html.twig', ['post' => $post]);
return $this->renderView('user/edit.html.twig', [...]);
return $this->renderForm(...)        // also valid
```

- `member_call_expression` where receiver is `$this` and method ∈ `{render,
  renderView, renderForm, stream}`.
- First argument is a `string` / `encapsed_string`.
- Path is relative to `templates/`.
- Stoplist: skip if the string contains `.` concatenation
  (`'blog/index.'.$_format.'.twig'` — runtime-computed extension, only
  the prefix `blog/index.` is partial). Could emit a fuzzy edge to all
  `blog/index.*.twig`, but defer.

### Symfony — services.yaml

```yaml
services:
    _defaults:
        autowire: true
    App\:
        resource: '../src/'
        exclude: '../src/{DependencyInjection,Entity,Kernel.php}'
    App\EventListener\Foo:
        arguments:
            $mailer: '@mailer'
```

Resolution:
- Glob-expand `App\: resource: '../src/'` against the filesystem, emitting
  *implicit* container registrations for every PHP class under `src/`.
- Named services with explicit class: edge from yaml line → class file.
- `arguments: $foo: '@bar'` introduces a *service-id → service-id* edge; defer
  unless we need it.

Requires a YAML parser. Coldstart has a YAML extractor at
`src/indexer/extractors/yaml.ts` but the import surface is unclear from this
spec's vantage; for the POC we use a minimal hand-rolled scanner that only
recognises the top-level `services:` block and `Foo\Bar: { class: ... }` / `Foo\Bar:` keys.

## Resolution rules summary

| Surface | Target form | Resolution |
|---|---|---|
| `hasMany(Foo::class)` in `app/Models/` | `Foo` (bare) | look up in `use` table of current file; PSR-4 to file |
| `hasMany('App\\Models\\Foo')` | FQCN string | PSR-4 to file directly |
| `@include('a.b.c')` | dotted view path | `resources/views/a/b/c.blade.php` |
| `@component('vendor::name')` | namespaced view | `resources/views/vendor/<vendor>/<name>.blade.php` |
| `app(Foo::class)`, `resolve(Foo::class)` | bare | as Eloquent |
| `$this->app->bind(A::class, B::class)` | bare pair | edge to both |
| `$this->render('a/b.html.twig')` | template path | `templates/a/b.html.twig` |
| `#[Route('/x')]` | n/a | tag method as route handler |
| `services.yaml: App\Foo: { class: A\B }` | FQCN | PSR-4 |
| `services.yaml: App\: resource: '../src/'` | glob | every `.php` under `<services.yaml dir>/../src/` |

## Stoplist

These FQCNs should never produce edges (framework-internal, will dilute the
ranking):

- Anything starting with `Illuminate\`, `Symfony\`, `Doctrine\`, `Laravel\`,
  `Psr\`, `League\`, `Carbon\`, `Monolog\`, `GuzzleHttp\`, `Twig\`.
- PHP built-ins: `\DateTime`, `\Closure`, `\Exception`, `\stdClass`, `\Throwable`,
  `\Generator`, `\Traversable`, `\ArrayAccess`, `\Countable`, `\Iterator`,
  `\IteratorAggregate`, `\JsonSerializable`, `\Stringable`, `\UnitEnum`,
  `\BackedEnum`.
- Plain `self`, `static`, `parent`, `$this`.

(The existing PSR-4 resolver implicitly stoplists these because no `psr-4` map
matches `Illuminate\` in the app's `composer.json`; only `App\` does. Edges
silently fail to resolve. That's fine. We do *not* add an explicit stoplist —
unresolved edges are a no-op.)

## Edge cases

- **Facade roots**: `Route::get(...)` — `Route` is an alias for
  `\Illuminate\Support\Facades\Route`; the underlying class lives in the
  framework. The static method call is statically resolvable to the facade's
  `__callStatic` and from there to the container binding. We do NOT chase
  facades to their bindings; we just recognise the surface form.
- **Magic methods**: Eloquent relationships are typically declared as concrete
  methods (`public function comments(): HasMany`). The actual `__call` magic on
  `Model` returning a `Relation` is rare in well-typed Laravel ≥9 code. Skip.
- **Dynamic class names**: `$class = $this->modelClass; new $class(...)`. Cannot
  statically resolve. Skip silently.
- **Service-id strings**: `app('foo.service')` requires walking every
  `register()` method in every service provider, building a name→class
  registry. Defer; mark unresolved.
- **Abstract bindings**: `$this->app->bind(IFoo::class, Foo::class)` — emit edge
  to BOTH. The user's reason to navigate may be either "where is `IFoo`
  implemented" or "where is `Foo` registered".
- **Polymorphic `morphTo()`**: no argument; cannot resolve.
- **Concatenated template paths** (`'blog/index.'.$ext.'.twig'`): mark
  unresolved.
- **Twig `{% include %}`** (inside template files): out of scope for this
  spec; would need a Twig extractor file-type.
- **`#[AsCommand]`, `#[AsEventListener]`, `#[AsController]` attributes**:
  defer until prioritisation justifies.
- **Multiple Eloquent relationships per method body**: rare in practice (one
  method = one relation by convention). If found, emit edges for all of them.

## Integration sketch

Touch points (no edits in this spec; described for future implementation):

1. `src/indexer/extractors/php.ts`
   - Add `RelationshipMethods` constant set (analogue to
     `RAILS_ASSOCIATION_METHODS` at `ruby.ts:82`).
   - In `visitTopLevel` for `class_declaration`, after the existing method
     extraction, walk method bodies for `member_call_expression` whose name is
     in the set and whose first arg is `class_constant_access_expression` /
     `string`. Push synthetic strings of shape `__rel__:<TargetName>` into
     `imports` (these survive deduplication and feed the resolver).
   - Same walk catches `app(Foo::class)`, `resolve(Foo::class)`,
     `$this->app->bind(A::class, B::class)`. Push `__container__:<Name>`.
   - Gate Eloquent extraction to files under `app/Models/` (path check on
     `fileId`). For the container case, no gate.
   - Skip `morphTo()`.

2. `src/indexer/resolvers/php.ts`
   - When a specifier starts with `__rel__:` or `__container__:`, strip the
     prefix and resolve the remaining name. For a bare class name, look up the
     enclosing file's import map (currently the extractor's `imports` list)
     before falling back to PSR-4. Resolver currently takes only `specifier`
     and `fromFile`; passing the per-file `use` table requires plumbing.
     Simplest path: do the bare-name → FQCN expansion *in the extractor*, so
     the resolver only ever sees full FQCNs.

3. Blade
   - Add a new extractor module `src/indexer/extractors/blade.ts` (or inline
     in `php.ts` if `.blade.php` is routed through it). File-extension routing
     in `src/indexer/parse.ts` needs a `.blade.php` branch.
   - Regex-extract `@include` / `@component` / `@extends`.
   - Emit `__blade__:<dotted.path>` import strings.
   - Resolver branch: convert to `resources/views/<dotted/path>.blade.php`,
     walk up from the file's dir to find the nearest `resources/views/`.

4. Symfony Twig
   - In `php.ts`, recognise `$this->render(...)` etc., emit `__twig__:<path>`.
   - Resolver branch: walk up to find `templates/` (Symfony's fixed convention)
     and look up `templates/<path>`.

5. Symfony services.yaml
   - Add `src/indexer/extractors/services-yaml.ts`. Only triggered for files
     matching `config/services.yaml`. Use a tiny scanner; do not pull a YAML
     library yet (the file format is regular enough to scan top-level keys).
   - Emit `__symfony__:<FQCN>` imports for each class key under `services:`.
   - For `App\: resource: '../src/'`, emit a single `__symfony_glob__:../src/`
     marker; the resolver expands it to every PHP file under the resolved dir
     (caller side does the glob to avoid bloat in the extractor).

6. `src/indexer/graph.ts`
   - No new synthetic-edge plumbing needed if items 1-5 emit import strings
     and the resolver maps them to real fileIds — they flow through the normal
     edge channel. Match `ruby.ts` pattern.

Estimated changes: ~150 LOC PHP extractor additions, ~50 LOC resolver
additions, ~30 LOC YAML extractor, ~40 LOC Blade extractor + parse.ts routing.

## Verification plan

- Run POC (`poc.ts`) against `/tmp/monica-laravel` and `/tmp/symfony-demo`,
  print proposed edges.
- Manually verify ≥10 TPs across at least four categories.
- Manually verify ≥5 TNs (relations whose target file does not exist /
  framework classes that should NOT receive edges).
- For each rule in the spec, eyeball whether the surface form fires on
  unintended sites (e.g. controller methods named `hasMany`, vendor blade
  components).
- Compare `get-overview` results for a Monica task before/after the changes
  once implemented. Bias-clean repo not required here (Monica is a real
  application, not a framework demo); for benchmark numbers go to MarkUs/JMRI
  per `feedback_claude_instruction_adherence`.

## Open questions

- Should Blade `.blade.php` files contribute to the symbol index at all
  (currently they aren't parsed)? If yes, do we surface `@section` /
  `@push` names as symbols? Probably not in v1.
- For `morphMany(Image::class, 'imageable')` we resolve `Image`. The
  `'imageable'` argument names a polymorphic relation column; we don't emit
  edges from it because the inverse side lives on multiple model files.
  Acceptable.
- `services.yaml`'s `App\: resource: '../src/'` glob: when expanded, every
  class in `src/` becomes "imported" from `services.yaml`. The graph density
  spike could hurt ranking. Alternative: emit ONE edge from `services.yaml`
  to the matched dir entry, not per-file. Decide at implementation time.
- Laravel 11+ middleware aliases moved out of `app/Http/Kernel.php`. Format
  is now `->withMiddleware(function (Middleware $middleware) { $middleware->alias([...]); })`
  in `bootstrap/app.php`. Defer.
