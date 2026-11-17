---
id: app-controllers-api-v4-split-registries-controller-rb-5fb75b1a
type: file
character: single
title: "app/controllers/api/v4/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","symbols":["show","split_registry_params"],"hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.821Z
edits: 1
---

# app/controllers/api/v4/split_registries_controller.rb

Only v3 and v4 read build_timestamp: v2 ignores it and always uses Time.zone.now. An invalid or blank value returns 422 with the model errors as JSON (render_errors), not 400. Nothing in this controller or its views sets Cache-Control or ETag headers.
