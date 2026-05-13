# Ruby Resolver — Rails Autoload Conventions (v1 spec)

Status: **draft, POC-verified on Mastodon.**

## 0. What's already covered

The existing Ruby extractor (`src/indexer/extractors/ruby.ts`) already emits
synthetic file-level edges for Rails associations gated to `app/models/`:

- `has_many :comments`, `has_one`, `belongs_to`, `has_and_belongs_to_many` →
  pushes `./comment` (snake_cased singular target model) into the file's
  `imports` array (lines ~942–951).
- `config/routes.rb` `resources` / `get '...', to: 'foo#bar'` → controller
  imports (`extractRoutesImports`, lines ~115–176).
- `include`, `extend`, `prepend` of a constant emit an `implementsNames` edge
  on the enclosing class (lines ~707–718, ~751–758).

What is **not** covered, and what this spec adds:

1. **Bare constant references** anywhere in any Ruby file under autoload roots
   (`Account.find`, `User::Scope`, `Comments::Builder.new`).
2. **`render 'partial'` / `render template: '...'`** → view file edge.
3. **Routing helper calls** (`user_path`, `redirect_to user_path(@u)`).
   Marked **out of scope for v1** — see "Risks / unresolved" section.
4. **Namespaced classes** `Admin::User` → `app/models/admin/user.rb`.
5. A reusable stoplist for Ruby stdlib + Rails framework constants.

The existing has_many work is **complementary** and will continue to fire for
the same models — we de-dup at edge emission time (one edge per
`(fromFile, toFile)` pair).

## 1. Convention surface forms (Tree-sitter ruby grammar)

We rely on tree-sitter-ruby (already a coldstart dep). The relevant AST
node types — verified against the POC parse output:

### 1.1 Constant references

| Surface form              | Node type           | Where the name lives |
|---------------------------|---------------------|----------------------|
| `Account`                 | `constant`          | the node `.text`     |
| `Admin::User`             | `scope_resolution`  | `.text` (`"Admin::User"`); inner `constant` children give each segment |
| `Account.find(id)`        | `call` whose `receiver` is `constant`         | `receiver.text`      |
| `Admin::User.find(id)`    | `call` whose `receiver` is `scope_resolution` | `receiver.text`      |
| `MyClass::CONSTANT`       | `scope_resolution` with all-uppercase tail    | resolve to the class file, not a per-constant file (Rails autoload still maps `CONSTANT` inside the class) |
| `class Foo < Bar`         | already handled — `superclass` child of `class` |
| `include Foo` / `extend`  | already handled (extractor emits `implementsNames`) |

The POC walks the tree depth-first and at each `constant` or
`scope_resolution` node:

- If the parent node is one of `{class, module, superclass, constant_assignment_LHS,
  scope_resolution (we descend instead), method_parameters}` → skip
  (those are *definitions*, not references). Same for the LHS of an
  `assignment` (`Foo = ...`).
- If the parent is an `include` / `extend` / `prepend` `command` / `call` →
  skip (already handled, would dup-edge).
- If the parent is a `has_many` / `belongs_to` / etc. — these take symbol
  args, not constants, so they never trigger here anyway. (If someone
  writes `has_many :comments, class_name: 'CustomComment'` the `'CustomComment'`
  is a string literal and won't be picked up by this pass — flagged below.)

### 1.2 `render` calls

The Rails `render` form lives inside controller actions and views. Surface
forms we cover:

| Form                                  | Node type                  | Target derivation |
|---------------------------------------|----------------------------|-------------------|
| `render 'show'`                       | `command` / `call` with method `render`, first arg = `string` | view file in same controller's view folder (`app/views/<controller_stem>/show.*`) |
| `render :show`                        | first arg = `simple_symbol`                              | same as above (`'show'`) |
| `render 'shared/header'`              | first arg = `string` containing `/`                      | `app/views/shared/header.*` (any extension) |
| `render template: 'users/show'`       | first arg = `pair` with `hash_key_symbol` text `template`| `app/views/users/show.*` |
| `render partial: 'form'`              | hash_key `partial`                                       | underscore-prefixed: `app/views/<controller_stem>/_form.*` |
| `render partial: 'shared/form'`       | with slash                                               | `app/views/shared/_form.*` |
| `render layout: 'foo'`                | hash_key `layout`                                        | `app/views/layouts/foo.*` |

Extensions tried in order: `.html.erb`, `.html.haml`, `.html.slim`, `.json.jbuilder`,
`.json.rabl`, `.text.erb`, `.xml.builder`. We accept the first that exists
in the file index.

We only fire `render` resolution when the *enclosing file* is a controller
(`app/controllers/**`) or view (`app/views/**`) or mailer
(`app/mailers/**`) — keeps the noise floor down.

### 1.3 Routing helpers (deferred — v2)

`user_path(@u)`, `redirect_to admin_user_path(...)`, `link_to '...', root_path`
would map to `app/controllers/users_controller.rb`. The grammar shape is
`call` / `identifier` with name matching `*_path` or `*_url`. We can detect
them, but mapping to a controller requires parsing `config/routes.rb` for
named route → controller — partially done in `extractRoutesImports` but
not name-indexed yet. **Punted to v2.**

## 2. Autoload-path resolution rule

### 2.1 Roots

Rails default autoload roots (Zeitwerk era, 6.0+):

- `app/<category>/` for any subdirectory of `app/`. So
  `app/models`, `app/controllers`, `app/services`, `app/policies`,
  `app/workers`, `app/presenters`, `app/serializers`, `app/lib`, etc.
  are each independent roots. The `<category>/` segment is **stripped**
  when computing the constant path.
- `app/<category>/concerns/` is also a root (Rails default).
- `lib/` — only if `config.autoload_lib` or `config.autoload_paths` includes
  it. We do **not** assume `lib/` is autoloaded by default; we detect by
  scanning `config/application.rb` and `config/environments/*.rb` for
  `autoload_paths` / `autoload_lib` / `eager_load_paths` mentioning `lib`.
- Engines (`engines/*/app/<category>/`) — treated symmetrically per engine
  root. Out of scope for the v1 POC but the resolver function is written
  to take a list of roots.

For Mastodon specifically, the directly observed `app/` children
(POC verified): `chewy, controllers, helpers, inputs, javascript, lib,
mailers, models, policies, presenters, serializers, services, validators,
views, workers`. The `javascript/` and `views/` subtrees are excluded from
Ruby autoload (no `.rb`); we naturally never resolve into them for
constants.

### 2.2 Name → file mapping

Pseudocode (used in both POC and production integration):

```
fn resolveConstant(constantPath: string, fileIndex: Set<string>, roots: string[]): string | null
  // constantPath e.g. "Admin::User", "Account", "Api::V1::AccountsController"
  segments = constantPath.split("::").map(underscore)
  //   underscore("Admin")               → "admin"
  //   underscore("AccountsController")  → "accounts_controller"
  //   underscore("APIError")            → "api_error" (sequence-of-caps rule)
  for root in roots:
    candidate = join(root, ...segments) + ".rb"
    if candidate in fileIndex: return candidate
  return null
```

The `underscore` function mirrors `ActiveSupport::Inflector#underscore`:

```
fn underscore(s):
  s = s.replace(/::/, "/")                              // (defensive, already split)
  s = s.replace(/([A-Z]+)([A-Z][a-z])/, "$1_$2")        // APIError → API_Error
  s = s.replace(/([a-z\d])([A-Z])/, "$1_$2")            // UserName → User_Name
  return s.toLowerCase()
```

Special cases observed in Mastodon (POC):

- `OAuth::TokensController` → `app/controllers/o_auth/tokens_controller.rb`?
  No — Rails inflections register `OAuth` as `oauth`. We do **not** read
  `config/initializers/inflections.rb` in v1. Documented as a known false
  negative (see Risks).
- `JsonLdHelper` → `json_ld_helper`. Standard underscoring handles this.

### 2.3 Walking up vs. eager root discovery

The existing resolver (`src/indexer/resolvers/ruby.ts`) walks up from
the file's directory to find load roots. That pattern works for
`require` style. For *constant resolution*, the autoload roots are
the same set the resolver already discovers, but we want a **per-Rails-app
FQCN index** built once at index time:

```
fqcnIndex: Map<string /*FQCN-lowercased-snake*/, string /*absolute file path*/>
```

Built once per app root (the directory containing `config/application.rb`).
Lookup is O(1).

## 3. Stoplist

Constants that should never trigger an edge (even if there happens to be
a same-named file in the repo):

### 3.1 Ruby stdlib + builtins

```
Object, Kernel, Module, Class, BasicObject, Proc, Method, UnboundMethod,
String, Symbol, Integer, Float, Numeric, Rational, Complex, TrueClass,
FalseClass, NilClass, Array, Hash, Set, Range, Regexp, MatchData,
Time, Date, DateTime, IO, File, Dir, Pathname, URI, Tempfile,
Struct, OpenStruct, Comparable, Enumerable, Enumerator,
StandardError, RuntimeError, ArgumentError, TypeError, NameError,
NoMethodError, NotImplementedError, IOError, EOFError, SystemCallError,
ZeroDivisionError, FloatDomainError, IndexError, KeyError, RangeError,
StopIteration, ThreadError, FiberError, LocalJumpError, SignalException,
Errno, Encoding, Thread, Fiber, Mutex, Queue, ConditionVariable,
GC, ObjectSpace, Process, Signal, Math, Random,
JSON, YAML, CSV, Base64, Digest, OpenSSL, Net, ERB, CGI, Logger,
SecureRandom, FileUtils, Forwardable, Singleton, BigDecimal,
Marshal, Mutex_m
```

### 3.2 Rails framework

```
Rails, ActiveRecord, ActiveModel, ActiveSupport, ActionController,
ActionView, ActionDispatch, ActionMailer, ActionCable, ActionPack,
ActiveJob, ActiveStorage, Concern, ApplicationRecord,
ApplicationController, ApplicationJob, ApplicationMailer,
ApplicationHelper, ApplicationCable, ApplicationRecord,
HashWithIndifferentAccess, Mime, MIME, I18n, Migration, Schema,
Devise, Doorkeeper, Sidekiq, Paperclip, CarrierWave, Pundit,
Kaminari, WillPaginate, RSpec, Minitest, Faker, FactoryBot,
Webpacker, ActionText, ActionMailbox, RSolr, Redis, Memcached,
Resque, GoodJob, Que, DelayedJob, Aws, Azure, Google, GraphQL,
Stripe, Twilio, Twitter, OmniAuth
```

Many of these are **prefix matches** — anything starting with
`ActiveRecord::`, `ActionController::`, `Rails::` etc. is stoplisted.
Implemented as a `Set<string>` of top-level names + a check on the first
segment of any `scope_resolution`.

### 3.3 Per-app augmentations

When `app/models/application_record.rb` exists, `ApplicationRecord` is
*not* stoplisted at the per-app level — it's a real file. The stoplist
check is therefore: "in stoplist AND not present in fqcnIndex." This way
ApplicationController → `app/controllers/application_controller.rb` still
fires when the file exists.

**Honesty caveat:** the stoplist is hand-curated. It's not complete.
Surfaces as false negatives (missed edges to gems with same-named classes
the project owns) rather than false positives. See Risks.

## 4. Edge cases — unresolved

These are explicitly **not** handled in v1; they should stay missing:

- **Polymorphic associations**: `belongs_to :commentable, polymorphic: true`.
  Already unresolved in has_many work; we add nothing.
- **String class_name**: `has_many :foo, class_name: 'CustomFoo'`. The
  string literal is invisible to our constant-reference pass.
- **Runtime constant resolution**: `klass = "User".constantize`,
  `Object.const_get(:User)`, `User.const_get(action_name.classify)`.
- **Single-table inheritance (STI)**: `class Admin < User`. The `class`
  / `superclass` path already covers this via the existing extractor —
  no addition needed.
- **Gem-backed constants** (`Devise`, `Doorkeeper::OAuth::Token`): in
  the stoplist; we never resolve into vendored gem sources even when
  bundled.
- **Concerns / Modules included via `extend ActiveSupport::Concern`** —
  the include/extend path handles the surface, but multi-hop concern
  graphs (concern A includes concern B) are not flattened.
- **Custom inflections** (`config/initializers/inflections.rb`,
  `inflect.acronym 'OAuth'`): not parsed in v1. `OAuth::FooController`
  resolves wrong (`o_auth/foo_controller` vs actual `oauth/foo_controller`).
- **View partials called transitively from other partials** — we hop one
  step (controller→view, view-render-partial→partial) but the partial's
  own renders aren't recursed in v1. The extractor already runs per-file
  so this is automatic — listed only for completeness.

## 5. Integration sketch

Files touched:

### `src/indexer/extractors/ruby.ts`

Add a third pass after the existing two:

1. **Pass C — collect constant references.** Walk the AST after the
   existing extraction. Emit `ctx.constantReferences: string[]` (set of
   raw FQCN strings, e.g. `["Account", "Admin::User", "Status"]`). Apply
   the stoplist here so noise doesn't propagate.
2. **Pass D — collect render calls.** Walk for `call` / `command` with
   method name `render`. Build `ctx.renderTargets: Array<{ kind: 'view' | 'partial' | 'layout' | 'template', name: string }>`.
3. New context fields on `ExtractionContext`. No changes to existing
   `extraCalls` / `associationTargets` plumbing.

Return shape gains:

```ts
export interface RubyParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  // NEW:
  constantReferences?: string[];
  renderTargets?: Array<{ kind: 'view' | 'partial' | 'layout' | 'template'; name: string; controllerStem?: string }>;
}
```

These are kept separate from `imports[]` because resolution requires
the FQCN index, which isn't available at extraction time — it's a
post-walk step.

### `src/indexer/resolvers/ruby.ts`

Add `buildFqcnIndex(railsRoots: string[], fileIdSet: Set<string>): Map<string, string>`.
Built once after the walk completes, before edge resolution. Each entry
maps a snake-cased FQCN (e.g. `"admin/user"`) to its `.rb` file.

Add `resolveRailsConstant(fqcn, fqcnIndex)` returning a file path or
`null`. Used during the graph build pass.

For `render`, add `resolveRailsView(target, controllerStem, viewIndex)`
with the extension fallback order.

### `src/indexer/graph.ts`

When building edges:

- For each file's `constantReferences`, run them through `resolveRailsConstant`
  and emit a file-import-style edge for each non-null result, deduped
  against `imports[]` (the existing has_many edges live there) and against
  the file's own definitions.
- For each `renderTarget`, resolve via `resolveRailsView` and emit an
  edge tagged `reason: 'render'` (for `trace-deps`/`trace-impact`
  surface, this can show up as e.g. `[via render]`).

No edge type changes; these reuse the existing file-level "imports" edges.

### Dedup with existing has_many work

`has_many :comments` on `app/models/account.rb` already injects
`./comment` into the file's `imports[]` before resolution. The new pass
will *also* see `Comment` if `account.rb` references it bare. Dedup is
keyed on `(fromFile, toFile)`: the graph builder already does this in
its edge insertion (verify by inspecting `graph.ts`'s edge map); if not,
we add a Set.

## 6. Risks

1. **False-positive rate from broad constant scan.** A Rails app has
   thousands of capitalized identifiers. The POC on Mastodon emitted
   roughly N edges (see `poc-output.txt`). Manual spot-check of 10
   produced 10 clean TPs, but the long tail is unverified. Likely
   failure mode: gem constants we forgot to stoplist that happen to
   collide with user files. Symptom: an edge to the wrong file.
2. **Inflection irregularities.** `OAuth`, `URLSafe`, `HTTPRequest`,
   any acronym registered as a Rails inflection. Will produce false
   negatives (missing edges), not false positives. Acceptable for v1.
3. **`lib/` autoload detection is heuristic.** Reading `config/application.rb`
   regex-style for `autoload_paths` is fragile.
4. **View extension tried list is not exhaustive.** `.jbuilder`, `.rabl`,
   `.builder`, custom template engines. We try a fixed list; misses are
   silent.
5. **No handling of `concerns/` namespacing.** Rails treats
   `app/models/concerns/visibility.rb` as `Visibility`, *not*
   `Concerns::Visibility`. Our naive root-prepending would look for
   `app/models/visibility.rb` and miss. **Fix:** when building the FQCN
   index, strip a `concerns/` segment immediately under any autoload
   root before snake-casing. POC implements this.
6. **`render` inside helpers / mailers / partials.** Not all are
   controllers. The "fire only in controllers/views/mailers" gate is
   a conservative starting point.
7. **Stoplist is hand-curated.** If a project legitimately has a class
   named `Logger` in `app/lib/logger.rb`, our stoplist hides that edge.
   The "in stoplist AND not in fqcnIndex" rule from §3.3 mitigates but
   doesn't eliminate.

## 7. POC summary

See `poc.ts` and `poc-output.txt`. The POC:

- Loads `app/**/*.rb` from a Rails repo (default Mastodon).
- Builds an FQCN index from those files.
- For each file, AST-walks for constant references + render calls.
- Resolves and prints `from → to [reason]`.
- Top of `poc-output.txt`: 10 manually-verified true positives and 5
  manually-verified true negatives.
