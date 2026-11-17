---
id: app-controllers-api-v1-split-configs-controller-rb-f16ad3c9
type: file
character: single
title: "app/controllers/api/v1/split_configs_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","symbols":["create","destroy"],"hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:14.202Z
edits: 1
---

# app/controllers/api/v1/split_configs_controller.rb

`destroy` does not delete or zero anything: it sets finished_at to now on the app's split found by name (find_by!, so an unknown name is a 404) and skips the write when the split is already finished, keeping the original finish time (spec/controllers/api/v1/split_configs_controller_spec.rb). Finishing removes the split from Split.active, while its registry, history and assignments stay. `create` permits only name and weighting_registry, so owner and the app-prefix rule are never set here; unprefixed names are accepted, and a dotted name must still start with the app's name. A POST to this endpoint revives a finished split with the same name (see SplitUpsert#save).
