---
id: app-models-split-upsert-rb-c04fe2ee
type: file
character: single
title: "app/models/split_upsert.rb"
anchors:
  - {"path":"app/models/split_upsert.rb","symbols":["save","merged_registry","split"],"hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.115Z
edits: 1
---

# app/models/split_upsert.rb

The single write path for split weights: save merges the posted weighting over the existing variant keys (omitted variants become 0, new keys are added) and calls Split#reassign_weight only when the merged registry differs. It assigns finished_at and decided_at from its own attributes on every save, so any save that omits them clears both: the API and admin weight changes un-decide a decided split and reactivate a finished one. Decision goes through reconfigure!, which passes no finished_at, so deciding a retired split also reactivates it.
