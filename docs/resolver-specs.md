# Resolver specs — status by stack

One-line status for each language stack we surveyed. Per-stack POC files and
full specs lived under `docs/resolver-specs/<stack>/` until 2026-05-16; they
were deleted after the design rationale was condensed here and into agent
memory (`feedback_resolver_design_decision_tree.md`).

See `feedback_resolver_design_decision_tree.md` for the path-regex-over-AST,
file-level-over-symbol decision framework that governs all new resolver work.

| Stack | Status | Easy-half scope (path-regex or deterministic literal lookup) |
|---|---|---|
| **Ruby/Rails** | Shipped (`d2a5a27`, `1f9b12a`, `5aae79d`) | Zeitwerk const-edges + erb/haml/slim walker + controller↔views folder-pairing. Implicit-render edges deferred. |
| **Python/Django** | Queued | `settings.py` dotted strings (`MIDDLEWARE`, `AUTHENTICATION_BACKENDS`, `TEMPLATES`, `ROOT_URLCONF`, `WSGI/ASGI_APPLICATION`), `urls.py include("…")`, `importlib.import_module("literal")`. `apps.get_model()` / `AUTH_USER_MODEL` deferred (needs INSTALLED_APPS phase). |
| **JVM (Java + Kotlin / Spring + JPA)** | Queued | Same-package short-name fix only. JPA relationships, DI by interface, `@Bean` factories deferred (needs post-walk FQCN/entity index). |
| **C# / .NET** | Queued | Partial classes only. DI registrations, EF nav, Razor (new file type), GlobalUsings deferred (phase change). |
| **PHP (Laravel / Symfony)** | Queued | Eloquent relationships gated to `app/Models/`, class-string container calls (`app(Foo::class)`, `resolve()`, `bind/singleton`). Blade templates + Symfony `services.yaml` deferred. |
| **JS/TS (Next.js / SvelteKit / Nuxt / NestJS)** | Dropped | Routing patterns are framework-churn-prone with no clear benchmark gain. Re-evaluate only on concrete user demand. |
| **Go / Rust / C++ / Groovy** | Low-convention | No path-regex affordance worth shipping. Existing import resolvers cover the common case. See git history at commit `0fe788f` for the gap survey if needed. |

## Why this file exists in place of the folder

The per-stack `spec.md` + `poc.ts` + `poc-output.txt` files were validation
artifacts for the design phase — once the decision tree consolidated the
lessons and the Ruby easy-half shipped, the POCs no longer carried unique
information. Recoverable from git history (commits `c9670dd`, `b24c00b`,
`432e499`, `e026417`, `aa1ad3b`, `1b0d432`, `0fe788f`) if needed.
