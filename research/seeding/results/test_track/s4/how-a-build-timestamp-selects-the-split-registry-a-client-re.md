---
id: how-a-build-timestamp-selects-the-split-registry-a-client-re
type: flow
title: "how a build timestamp selects the split registry a client receives (v3 and v4)"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v3/split_registries_controller.rb","hash":"sha256:9b3d620ec198","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/models/split_registry.rb","hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/views/api/v3/split_registries/show.json.jbuilder","hash":"sha256:ddb661939690","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:38.300Z
edits: 1
---

# how a build timestamp selects the split registry a client receives (v3 and v4)

The v3 and v4 routes name the URL segment `:timestamp` (config/routes.rb `resources :builds, param: :timestamp`), but both controllers read `params[:build_timestamp]`, so a live request passes nil into SplitRegistry, validation fails and the response is 422; the controller specs pass `build_timestamp:` directly and never go through the router. When the timestamp is valid, SplitRegistry#splits is Split.active(as_of:), which keeps splits whose finished_at is null or later than the timestamp, so a split retired after the build is still served. The response shape is decided by the view, and v3 and v4 differ.

## Steps

1. `config/routes.rb` (`split_registry`) — declares /api/v3/builds/:timestamp/split_registry and the v4 twin; the segment is :timestamp, not :build_timestamp
2. `app/controllers/api/v3/split_registries_controller.rb` (`show`, `split_registry_params`) — builds SplitRegistry from params[:build_timestamp], renders the view only if valid?, else render_errors (422)
3. `app/models/split_registry.rb` (`SplitRegistry`) — ActiveModel validation of as_of (presence plus ISO-8601 regex with optional milliseconds and Z or +-hh:mm offset)
4. `app/models/split.rb` (`active`) — scope: finished_at null or finished_at > as_of; with no argument it means finished_at null
5. `app/views/api/v3/split_registries/show.json.jbuilder` (`splits`) — renders splits as an object keyed by split name (weights, feature_gate) plus experience_sampling_weight
6. `app/controllers/concerns/cors_support.rb` (`set_cors_headers`) — after_action adds CORS headers; raises if WHITELIST_CORS_HOSTS is unset, on every request through this concern

## Invariants

- as_of is the only time input: v2 passes Time.zone.now and never calls valid?, v3 and v4 must receive a valid ISO-8601 string
- a preflight OPTIONS request is answered only where routes.rb declares an OPTIONS match; for v3 and v4 split_registry none is declared, only the v1 split_registry has one
- the view is found by convention (api/v3/split_registries/show), so a new version needs its own view file as well as its route and controller
