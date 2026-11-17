---
id: app-models-split-upsert-rb-c04fe2ee
type: file
character: single
title: "app/models/split_upsert.rb"
anchors:
  - {"path":"app/models/split_upsert.rb","symbols":["SplitUpsert","zeroed_registry","feature_gate?","save","merged_registry"],"hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.772Z
edits: 2
---

# app/models/split_upsert.rb

SplitUpsert#save assigns finished_at and decided_at from its accessors on every save, so a caller that does not pass them writes nil and clears the stored value; Split#reconfigure! and Split#reweight! both go through here. The weighting is merged over the existing keys with zeros (zeroed_registry), so a caller only needs to send the winning variant. A changed registry is archived as a PreviousSplitRegistry before the new one is set.
