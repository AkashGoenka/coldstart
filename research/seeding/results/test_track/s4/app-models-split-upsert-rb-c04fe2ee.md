---
id: app-models-split-upsert-rb-c04fe2ee
type: file
character: single
title: "app/models/split_upsert.rb"
anchors:
  - {"path":"app/models/split_upsert.rb","symbols":["save","merged_registry","split"],"hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.861Z
edits: 1
---

# app/models/split_upsert.rb

`save` assigns `owner` only when it is non-nil, so omitting it keeps the split's owner, while an empty string is assigned. The submitted weights are merged over the existing split's registry with each known variant set to 0, so a variant missing from the request is zeroed, not removed. `split` is found by name within `app.splits` and created with the merged registry and a feature_gate flag derived from a name ending in `_enabled`. Weights are reassigned before `valid?` runs, so a failed validation leaves the in-memory split changed, but nothing is saved.
