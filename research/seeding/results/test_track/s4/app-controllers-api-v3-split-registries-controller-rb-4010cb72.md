---
id: app-controllers-api-v3-split-registries-controller-rb-4010cb72
type: file
character: single
title: "app/controllers/api/v3/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v3/split_registries_controller.rb","symbols":["show","split_registry_params"],"hash":"sha256:9b3d620ec198","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:38.316Z
edits: 1
---

# app/controllers/api/v3/split_registries_controller.rb

Reads the timestamp from params[:build_timestamp], but config/routes.rb gives this route the segment name :timestamp, so in a real request the value is nil and the model rejects it with 422. Controller specs pass build_timestamp straight into get :show and so cannot see the gap. The v4 controller is the same code.
