---
id: how-a-new-api-version-is-wired-adding-v5
type: flow
title: "how a new API version is wired (adding v5)"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
  - {"path":"spec/controllers/api/v4/split_registries_controller_spec.rb","hash":"sha256:10aff24f42eb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:34.058Z
edits: 1
---

# how a new API version is wired (adding v5)

The only list of API versions is config/routes.rb: each namespace :vN block declares its routes, and the controllers, views and specs are found by the Api::VN naming convention alone. Browser CORS preflight stubs exist only in the v1 and v2 blocks, so a v5 route that browsers call cross-origin needs its own OPTIONS stubs added by hand. The v4 files are the closest template, and they include CorsSupport, which fails without an environment variable.

## Steps

1. `config/routes.rb` — the namespace :v4 block (builds/:timestamp/split_registry) is the newest template; v1 and v2 declare OPTIONS routes to Api::V1::CorsController#allow for preflight, v3 and v4 declare none.
2. `app/controllers/api/v4/split_registries_controller.rb` (`show`) — template controller: inherits UnauthenticatedApiController and includes CorsSupport; invalid as_of renders errors from the SplitRegistry validations.
3. `app/controllers/concerns/cors_support.rb` (`CorsSupport`, `cors_allowed?`, `whitelisted_hosts`) — after_action on every action; whitelisted_hosts raises unless ENV['WHITELIST_CORS_HOSTS'] is set, so a new versioned controller that includes it fails without that variable.
4. `app/views/api/v4/split_registries/show.json.jbuilder` — renders splits with name, variants (name and weight) and feature_gate, plus experience_sampling_weight.
5. `spec/controllers/api/v4/split_registries_controller_spec.rb` — controller spec pattern: RSpec.describe the Api::V4 controller, get :show with build_timestamp, and response_json assertions.

## Invariants

- Rails maps Api::V5::Foo to app/controllers/api/v5/foo_controller.rb and app/views/api/v5/foo/ by name; nothing else registers versions.
- .rubocop_todo.yml lists the v4 files by path (its v4 entries); a new v5 file has no entry there.
- The versioned controller specs are in spec/controllers/api/vN; request specs exist only under spec/requests/api/v1.
