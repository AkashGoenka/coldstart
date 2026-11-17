---
id: app-controllers-api-v2-migrations-splits-controller-rb-4a929dc9
type: file
character: single
title: "app/controllers/api/v2/migrations/splits_controller.rb"
anchors:
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","symbols":["create"],"hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:14.207Z
edits: 1
---

# app/controllers/api/v2/migrations/splits_controller.rb

`create` is the v1 create path with require_app_name_prefix forced to true and owner permitted, so this is the only API route that sets owner. With that flag a single-segment name is rejected and a dotted name must match the app's name, but Split's name validation returns early when the name is unchanged, so reweighting an existing unprefixed split through this endpoint still passes. Route is POST /api/v2/migrations/split (config/routes.rb).
