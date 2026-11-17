---
id: app-controllers-api-v1-split-registries-controller-rb-2e40b56c
type: file
character: single
title: "app/controllers/api/v1/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/split_registries_controller.rb","symbols":["for_presentation"],"hash":"sha256:06318cf68bfb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.353Z
edits: 1
---

# app/controllers/api/v1/split_registries_controller.rb

show calls Split.for_presentation with no argument, which is the plain unfinished-splits scope: no timestamp, no feature-gate or remote-kill knockouts. The v1 route has no build segment, so a v1 client cannot ask for a build-specific registry. The view writes a flat hash of split name to weights, with no feature_gate flag and no experience_sampling_weight.
