---
id: app-controllers-api-v4-split-registries-controller-rb-5fb75b1a
type: file
character: single
title: "app/controllers/api/v4/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","symbols":["SplitRegistry","split_registry_params"],"hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.367Z
edits: 1
---

# app/controllers/api/v4/split_registries_controller.rb

show passes params[:build_timestamp] into SplitRegistry.new(as_of:) and renders 422 with the model's errors when it is blank or malformed; the v3 controller is identical. Splits finished at or before the build timestamp drop out, and no knockouts are applied, so a remote-killed split shows its stored weights here while the config endpoint for the same build shows it knocked out.
