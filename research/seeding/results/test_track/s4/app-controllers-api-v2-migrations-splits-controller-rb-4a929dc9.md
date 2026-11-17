---
id: app-controllers-api-v2-migrations-splits-controller-rb-4a929dc9
type: file
character: single
title: "app/controllers/api/v2/migrations/splits_controller.rb"
anchors:
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","symbols":["create","create_params"],"hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.856Z
edits: 1
---

# app/controllers/api/v2/migrations/splits_controller.rb

`create` builds a SplitUpsert from `create_params` and adds `app: current_app` and `require_app_name_prefix: true` itself, so a caller cannot set either. `current_app` is set by the basic-auth check in AuthenticatedApiController, which rejects a missing or wrong app secret before this action runs. `create_params` permits `:owner`, and the weighting registry only for the keys submitted, so non-scalar values are dropped. A new permitted key must also be an attr_accessor on SplitUpsert, since the params are passed straight through.
