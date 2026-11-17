---
id: app-controllers-api-v2-split-registries-controller-rb-8a1b0e30
type: file
character: single
title: "app/controllers/api/v2/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v2/split_registries_controller.rb","symbols":["SplitRegistry"],"hash":"sha256:955205cd8a92","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.359Z
edits: 1
---

# app/controllers/api/v2/split_registries_controller.rb

The only registry controller that takes its cut from the server clock: SplitRegistry.new(as_of: Time.zone.now) at request time, with no request parameter read and no validity check. Its view nests weights and feature_gate under each split name and emits experience_sampling_weight.
