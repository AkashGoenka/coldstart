# Python resolver: Django / Flask / FastAPI / Celery / importlib convention references

Status: research spec. No production code changes proposed in this document.

## Why

`src/indexer/resolvers/python.ts` and `src/indexer/extractors/python.ts` cover only
explicit references: `import x`, `from x import y`, dotted-name path → file. That
misses essentially every important inter-file reference in Django and Flask apps,
which use convention-over-configuration runtime binding by **string**. Concrete
coverage gap measured on `~/benchmark/repos/arches/arches-coldstart` (a real
Django app):

- `arches/settings.py` references middleware classes, auth backends, and installed
  apps as **dotted strings**: `"arches.app.utils.middleware.SetAnonymousUser"`.
  The graph today shows zero edges from `settings.py` to `app/utils/middleware.py`
  even though it's the canonical entry point.
- `arches/urls.py` uses `include("oauth2_provider.urls")` for sub-URLconfs; this
  is a dotted string, not an import. Today coldstart misses the edge.
- `apps.get_model("models", "GraphModel")` appears 100+ times in migrations and
  signal handlers — a hard-coded ORM hop with no `import` to anchor it.
- `importlib.import_module(directory + ".%s" % mod_path)` in
  `app/utils/module_importer.py` is the entire plugin discovery surface and is
  completely unresolvable at static-graph time without dotted-string heuristics.
- `templatetags/` files are discovered by **directory name**: `{% load
  template_tags %}` in a template ⇒ `arches/templatetags/template_tags.py`. The
  loader is `apps.py`-registration plus filesystem scan.
- Celery `@shared_task` definitions are dispatched by string name via `send_task`
  / signature names; cross-file `name='arches.app.tasks.foo'` edges are invisible.

This follows the same pattern as Rails work in `src/indexer/extractors/ruby.ts`
(see `RAILS_ASSOCIATION_METHODS` at line 82 and `extractRoutesImports` at
line 115): detect a known DSL surface form, map to a target file via
deterministic naming convention, emit a synthetic file-level edge.

See also the cross-cutting memo
`feedback_implicit_reference_resolver_gap`: framework name→file mapping is the
generalisation; this spec is the Python instance.

## Priorities (high → low)

Ranked by signal-per-line-of-code observed in arches. Ship in this order; stop
when ROI drops. Items 1, 2, 8 are by far the biggest gaps.

1. **Django settings dotted strings** — `MIDDLEWARE`, `INSTALLED_APPS`,
   `AUTHENTICATION_BACKENDS`, `TEMPLATES[*]["OPTIONS"]["context_processors"]`,
   `WSGI_APPLICATION`, `ROOT_URLCONF`, `DEFAULT_AUTO_FIELD`, `AUTH_USER_MODEL`,
   `LOGGING['handlers'][*]['class']`. Dense, deterministic, every Django repo
   has them.
2. **Django URLconf `include(...)`** — string-form `include("app.urls")` is the
   sub-URLconf entry point; not an import. (The `path("x/", views.foo)` callable
   form is already resolved via the normal `from ... import views` edge.)
3. **`importlib.import_module("a.b.c")`** with a literal string argument.
   Same dotted→file rule as a normal import; just hidden behind a function call.
   Skip non-literal arguments (concatenations, f-strings) — those are deferred.
4. **`apps.get_model("app_label", "Model")` / `apps.get_model("app_label.Model")`**
   — Django ORM late binding. Maps `app_label` → installed-app module → models.py.
5. **`AUTH_USER_MODEL = "users.User"` style settings** — same shape as 4.
6. **Celery task names** — `@shared_task(name="arches.app.tasks.do_work")` and
   `app.send_task("arches.app.tasks.do_work")` / `signature("...")`. The name
   default (when no `name=` given) is `module.function`; can be reconstructed
   from the file path.
7. **Django signals `dispatch_uid` and `Signal.connect(receiver, ...,
   dispatch_uid="my.dotted.path")`** — only when the uid is structured as a
   dotted module path. Heuristic; conservative.
8. **Django templatetags discovery** — files at `**/templatetags/*.py` are
   loaded by basename via `{% load <basename> %}` from templates. Emit edge
   from each `*.html` (or any template under `**/templates/**`) that contains
   `{% load name %}` → matching templatetags module. **DEFERRED for v1** —
   requires HTML scanning, see below.
9. **Flask blueprints** — `app.register_blueprint(<module>.<bp_var>)` /
   `register_blueprint(<bp_var>)` where `<bp_var>` is already imported. Usually
   resolves via the existing `import` edge; the synthetic value is the
   *registration* signal (file is an entry-point), not a new file edge. Defer.
10. **FastAPI `app.include_router(router)`** — same as Flask blueprints; routers
    are typically `import`'d. Defer.
11. **FastAPI `Depends(get_db)`** — `get_db` is typically `import`'d; defer.
12. **`__import__("a.b.c")`** literal-string form. Cosmetic completeness — almost
    never used in real apps. Defer.

## Surface forms (concrete Tree-sitter python nodes)

All match against `tree-sitter-python` named nodes. We walk top-level
expression statements and selected call expressions. Where a value is computed
(`MIDDLEWARE.insert(0, "...")`, `MIDDLEWARE += [...]`) we still want to harvest
the string args.

### 1. Django settings dotted strings

Settings files are identified by **filename** (`settings.py`, `settings_*.py`,
or any `*.py` directly under a dir whose name matches `settings`). False
positives outside settings are cheap to reject downstream because resolution
will simply miss.

Recognised keys (case-sensitive, top-level assignments only):

```
MIDDLEWARE, MIDDLEWARE_CLASSES,
INSTALLED_APPS,
AUTHENTICATION_BACKENDS,
TEMPLATES,                                  # nested: ["OPTIONS"]["context_processors"]
LOGGING,                                    # nested: ["handlers"][*]["class"], ["filters"][*]["()"]
ROOT_URLCONF, WSGI_APPLICATION, ASGI_APPLICATION,
DEFAULT_AUTO_FIELD,
AUTH_USER_MODEL,                            # "app_label.Model" — see rule below
PASSWORD_HASHERS,
DEFAULT_FILE_STORAGE, STATICFILES_STORAGE,  # Django <5
STORAGES,                                   # Django 5+, nested dict
REST_FRAMEWORK,                             # nested: many string class refs
CELERY_BEAT_SCHEDULE,                       # nested: ["task"]
```

For each key we recursively walk the RHS expression, collecting every
`string` node whose unquoted content matches `^[a-zA-Z_][a-zA-Z0-9_.]*$` and
contains at least one `.`. The presence of a dot is the cheap, high-precision
filter that distinguishes dotted module paths from arbitrary string config
values (URLs, regexes, labels). Append/insert/`+=` mutations are picked up by
the same generic walker over the file.

Tree-sitter node shape (top-level):

```
module
└── expression_statement
    └── assignment
        ├── identifier "MIDDLEWARE"
        └── list / tuple / dictionary
            └── string  ← read string_content
```

For nested keys (`TEMPLATES`, `LOGGING`, `STORAGES`, `REST_FRAMEWORK`,
`CELERY_BEAT_SCHEDULE`) we walk the entire subtree of the RHS rather than
trying to address specific keys — the dotted-string heuristic is precise
enough that we don't need to know which key we're inside.

### 2. Django URLconf `include(...)`

```python
re_path(r"^o/", include("oauth2_provider.urls", namespace="oauth2"))
path("admin/", include("django.contrib.admin.urls"))
```

Match `call` where `function.text == "include"` AND first positional argument
is a `string` literal. URL-conf scope is enforced by filename: only inside
files whose basename is `urls.py` or whose path matches `**/urls/*.py`. Resolve
the string as a dotted Python module path.

### 3. `importlib.import_module(...)`

```python
import importlib
module = importlib.import_module("arches.app.utils.thumbnail_factory")
```

Match `call` where the function is `attribute` with `object.text == "importlib"`
and `attribute.text == "import_module"`. First arg must be a `string` literal —
**reject `binary_operator`, `f-string`, `concatenated_string`, `+` of identifier**
(arches has many of these; they are deliberate true negatives).

### 4. `apps.get_model(...)`

Two call signatures:

```python
apps.get_model("authentication", "User")    # ("app_label", "ModelName")
apps.get_model("authentication.User")        # combined
```

Match `call` where function is `attribute` with `attribute.text == "get_model"`.
Receiver text is typically `apps` (Django app registry) but we also accept any
identifier; the get_model name is rare enough to be safe.

App-label → module resolution: scan `INSTALLED_APPS` from the project's
`settings.py` for a dotted module ending in `<app_label>`; if found, target is
`<that_module>/models.py` (or `<that_module>/models/__init__.py`). Fallback:
search the file-index for any `**/<app_label>/models.py` and emit if exactly
one match.

### 5. `AUTH_USER_MODEL = "..."`

`AUTH_USER_MODEL` (and any string that satisfies `^[a-z_]+\.[A-Z][A-Za-z0-9_]*$`)
is treated as `app_label.ModelName`. Same resolution as item 4.

### 6. Celery `@shared_task(name=...)` / `app.task(name=...)` / `send_task("...")`

Two surfaces:

- **Definition**: `decorated_definition` where the decorator is `call`-shape
  with function text `shared_task`, `app.task`, `celery.task`, or `<varname>.task`
  AND it has a `keyword_argument` with `name == "name"` and value `string`.
- **Invocation**: `call` where function ends in `send_task` (any receiver), and
  first positional arg is a `string` literal; OR
  `signature("dotted.task.name", ...)` / `Signature("...")` similar shape.

For a literal Celery name `arches.app.tasks.foo` we resolve as a dotted module
path **stripped of its last segment** (`foo` is the function inside
`arches/app/tasks.py`).

When `@shared_task` has no `name=`, Celery defaults the name to
`module.function`. We don't synthesise an edge for default-named tasks at the
definition site (no need — `send_task` will reach the same file via the
explicit dotted argument).

### 7. Signal `dispatch_uid` and `Signal.connect(..., dispatch_uid="...")`

Match `string` argument with key `dispatch_uid=` where the unquoted value looks
like a dotted module path (`^[a-zA-Z_][a-zA-Z0-9_.]*\.[a-zA-Z_][a-zA-Z0-9_]+$`).
Conservative; many projects use UUID-ish strings for `dispatch_uid` which we
correctly skip. **DEFERRED for v1** unless we find ≥2 clean true positives in
arches.

### 8. Templatetags `{% load %}` discovery — DEFERRED

The naming convention is unambiguous:

```
arches/templatetags/template_tags.py  ⇐  {% load template_tags %}  in templates
```

Edge shape: `<template.html>` → `<app>/templatetags/<basename>.py` for every
`{% load <name> %}` directive found. Skip Django builtins
(`{% load i18n %}`, `{% load static %}`, `{% load humanize %}`,
`{% load admin_*`, `{% load tz %}`).

DEFERRED for v1 because:
- requires scanning `*.html` files (currently outside the Python extractor scope);
- needs a side index of `templatetags/` modules to map names to files;
- arches has only one templatetag module so the validation surface is thin.

Recommend lifting in v2 once we have a generic "non-source asset" scanner.

## Resolution rules

### Dotted module path → file

For a string `"a.b.c.Symbol"`:

1. If the last segment starts with an uppercase letter, treat it as a class name
   and the dotted prefix `"a.b.c"` as the module. Otherwise treat the whole
   string as the module path (e.g. `oauth2_provider.urls`).
2. Walk up from the file's own directory looking for `<ancestor>/a/b/c.py` or
   `<ancestor>/a/b/c/__init__.py` (mirrors the existing absolute-import logic
   in `src/indexer/resolvers/python.ts` lines 50–67). Accept also `src/` layout.
3. If nothing resolves, drop the edge silently. **Never emit an edge to a file
   not in the index** — required for parity with Ruby/PHP.

### App label → module (for `apps.get_model`, `AUTH_USER_MODEL`)

1. Read `INSTALLED_APPS` from the file's nearest ancestor `settings.py`. For
   each installed app `pkg.sub.app_label`, the candidate models module is
   `pkg/sub/app_label/models.py` or `pkg/sub/app_label/models/__init__.py`.
2. Match by trailing segment (`app_label == basename of installed app`).
3. Fallback: glob `**/<app_label>/models.py` over the index. If exactly one
   match, take it; if zero or multiple, drop.

### Settings.py discovery

To resolve app labels we need to know the project's `INSTALLED_APPS`. Strategy
in the extractor pass:

- During parse pass 1, collect a side map `{settingsFileId: installedApps[]}`
  for every file named `settings.py` or `settings_*.py`.
- During pass 2, when emitting synthetic edges, pick the settings file whose
  directory is the nearest ancestor of the current file. This handles
  multi-project repos.

(Phase ordering: in coldstart this means convention edges resolve during the
existing import-resolution stage in `src/indexer/graph.ts`, not at extractor
time. The extractor only collects surface forms.)

## Stoplist (concrete)

We **drop** strings matching any of these before resolution. The point is not
to suppress edges that would resolve correctly anyway (resolver returns null
harmlessly), but to keep the noise floor low for downstream analysis tools.

```
^django\.                       # Django framework internals
^flask(\.|$)                    # Flask internals
^fastapi(\.|$)
^starlette(\.|$)
^pydantic(\.|$)
^sqlalchemy(\.|$)
^celery(\.|$)
^kombu(\.|$)
^rest_framework(\.|$)           # Django REST framework
^oauth2_provider(\.|$)          # commonly third-party in INSTALLED_APPS
^guardian(\.|$)
^corsheaders(\.|$)
^django_celery_(beat|results)\b
^django_hosts(\.|$)
^debug_toolbar(\.|$)
^silk(\.|$)
^webpack_loader(\.|$)
```

Plus stdlib roots: `logging`, `logging.handlers`, `os`, `sys`, `io`, `re`,
`json`, `pathlib`, `typing`, `collections`, `functools`, `itertools`, `hashlib`,
`asyncio`, `dataclasses`, `enum`, `datetime`, `uuid`.

**Implementation note:** the stoplist is advisory. The resolver already returns
null for any specifier that doesn't exist under the project root, so the
stoplist is a noise-reduction filter, not a correctness gate. Keep it in one
place (e.g. `src/indexer/extractors/python.ts` top-of-module constant) so it
can be tuned per-repo if needed.

## Edge cases left unresolved (NOT in v1)

These are honestly hard and we don't attempt them:

- **Dynamic class lookup**: `getattr(importlib.import_module(mod), cls)` where
  either `mod` or `cls` is a runtime value. Arches uses this pattern in
  `app/utils/thumbnail_factory.py` and `app/tasks.py:581`. We emit the
  `import_module` edge if the module arg is literal, but no edge for the
  class hop.
- **Conditional imports under `TYPE_CHECKING`**: out of scope; today's
  extractor already includes them in `imports[]` — leave as-is.
- **Plugin discovery via setuptools `entry_points`**: `pkg_resources` /
  `importlib.metadata.entry_points(group='django.apps')`. These are runtime
  registry reads with no static surface form. Skip.
- **Runtime decorator registration**: `@register("admin")` where the registry
  is built at import time. We don't track call-site → registry membership.
- **String concatenation in `import_module`**:
  `importlib.import_module(prefix + "." + name)` — common in plugin loaders.
  Conservative skip is correct; false positives here would be very expensive
  to defend.
- **Settings overrides via `os.environ` / 12-factor**: many real settings files
  do `DATABASES = {...env-driven...}`. We don't attempt to resolve env-driven
  module paths.
- **Django Admin auto-registration**: `admin.py` files are auto-loaded by
  `django.contrib.admin.autodiscover()`. We don't emit `<project>/admin →
  <app>/admin.py` edges in v1; the path-based scanner would need to walk
  every `INSTALLED_APPS` entry.
- **AppConfig.ready() registrations**: `app/apps.py:ready()` often imports
  `signals.py` for side-effects — but it's an explicit `import` so already
  resolved.

## Integration sketch into coldstart

Three files are touched. Keep the change shape **identical** to the Rails
pattern in `src/indexer/extractors/ruby.ts` (line 82 `RAILS_ASSOCIATION_METHODS`,
line 115 `extractRoutesImports`, line 943 `if (fileId.includes('app/models/'))`).

### 1. `src/indexer/extractors/python.ts`

Add at top:

```ts
const PYTHON_STOPLIST_PREFIXES = new Set([
  'django.', 'flask.', 'fastapi.', 'starlette.', 'pydantic.',
  'sqlalchemy.', 'celery.', 'kombu.', 'rest_framework.',
  'oauth2_provider.', 'guardian.', 'corsheaders.',
  'django_celery_beat.', 'django_celery_results.', 'django_hosts.',
  'debug_toolbar.', 'silk.', 'webpack_loader.',
  // stdlib
  'logging.', 'os.', 'sys.', 'io.', 're.', 'json.',
  'pathlib.', 'typing.', 'collections.', 'functools.',
  'itertools.', 'hashlib.', 'asyncio.', 'dataclasses.',
  'enum.', 'datetime.', 'uuid.',
]);

const SETTINGS_KEYS = new Set([
  'MIDDLEWARE', 'MIDDLEWARE_CLASSES', 'INSTALLED_APPS',
  'AUTHENTICATION_BACKENDS', 'TEMPLATES', 'LOGGING',
  'ROOT_URLCONF', 'WSGI_APPLICATION', 'ASGI_APPLICATION',
  'DEFAULT_AUTO_FIELD', 'AUTH_USER_MODEL',
  'PASSWORD_HASHERS', 'STORAGES',
  'DEFAULT_FILE_STORAGE', 'STATICFILES_STORAGE',
  'REST_FRAMEWORK', 'CELERY_BEAT_SCHEDULE',
]);
```

Add a `collectConventionStrings(root, fileId)` walker that returns
`string[]` of dotted module paths to append to `imports[]`. Branch on filename:

- `basename === 'settings.py' || basename.startsWith('settings_')`:
  scan for assignments whose LHS is in `SETTINGS_KEYS`, recursively collect
  every `string` whose content matches `/^[a-zA-Z_][a-zA-Z0-9_.]*\.[a-zA-Z_][a-zA-Z0-9_]+$/`,
  drop those starting with anything in `PYTHON_STOPLIST_PREFIXES`, return.
- `basename === 'urls.py' || /\burls\b/.test(dirname)`:
  scan for `call` nodes where function text is `include` with a string first arg.
- Always: walk all `call` nodes once for `importlib.import_module("...")`,
  `apps.get_model("...", "...")`, `send_task("...")`, and
  `signature("...")`.

Splice these into `imports` at the bottom of `parsePythonContent` just like
Rails does (line 947 `imports.push(importPath)`):

```ts
const conventionImports = collectConventionStrings(root, fileId);
for (const imp of conventionImports) {
  if (!imports.includes(imp)) imports.push(imp);
}
```

### 2. `src/indexer/resolvers/python.ts`

No changes for items 1–3 and 6 — the dotted module path is already what the
absolute-import branch (lines 50–67) handles.

For `apps.get_model` (item 4) and `AUTH_USER_MODEL` (item 5) we need an
**app-label → module path** lookup. Two options:

- **Simple**: emit the dotted form directly from the extractor by guessing
  `<some_prefix>.models` and relying on the index-hit check. Cheap but
  imprecise.
- **Right**: add a side map from `settings.py` (`{appLabel → moduleDir}`) and
  resolve at graph build time.

Recommend "Simple" for v1 — emit `app_label.models` and let the resolver fall
through to the file-index walk-up loop. If that produces ≥30 % false negatives
we add the side map.

### 3. `src/indexer/graph.ts`

No structural change. The extractor already appends to `imports[]` and the
existing edge-build pass handles the rest. The new edges become indistinguishable
from explicit imports in the graph — matching Rails behaviour today.

## Prioritisation within Python (ship plan)

If we ship in increments rather than one PR:

1. **PR 1** — Settings dotted strings + URLconf `include(...)`. Biggest gap;
   isolated; safe; ~150 LOC.
2. **PR 2** — `importlib.import_module` literal-string + `apps.get_model`.
   Same surface form (call expression with string arg). ~80 LOC.
3. **PR 3** — Celery `@shared_task(name=)` definitions and `send_task(...)`
   calls. Needs a small task-name index to be useful. ~120 LOC.
4. **PR 4** — Templatetags discovery (requires HTML scan; bigger change).
5. **PR 5** — Signal `dispatch_uid` (only if real signal-heavy repo lands).

Stop after PR 2 unless we see concrete uptake gains in the
benchmark. PR 1–2 alone should close ~70 % of the gap measured on arches
(see POC output).
