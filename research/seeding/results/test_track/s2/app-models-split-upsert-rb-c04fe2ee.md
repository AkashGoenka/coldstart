---
id: app-models-split-upsert-rb-c04fe2ee
type: file
character: single
title: "app/models/split_upsert.rb"
anchors:
  - {"path":"app/models/split_upsert.rb","symbols":["SplitUpsert","merged_registry","feature_gate?"],"hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:34.015Z
edits: 1
---

# app/models/split_upsert.rb

`save` is a partial-registry upsert: `merged_registry` starts from every variant weight already on the split with that name, zeroes them, then overlays the weighting_registry it was given, so variants left out of the payload drop to 0 instead of keeping their weight. `feature_gate` is derived from the `_enabled` name suffix but reaches the record only through `create_with`, so it is set when the split is first created and a later save never changes it. `SplitUpsert.create` returns the object whether or not it saved, so callers must check `errors` or `save`'s return value. `Split#build_config` and `reconfigure!` drive this object through `save!`, and the v2 migrations path adds `require_app_name_prefix: true`.
