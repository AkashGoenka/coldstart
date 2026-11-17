---
id: app-models-split-rb-ba157a17
type: file
character: single
title: "app/models/split.rb"
anchors:
  - {"path":"app/models/split.rb","symbols":["registry","for_presentation","active","reassign_weight","decided_variant"],"hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.895Z
edits: 1
---

# app/models/split.rb

Split#registry is a Hash of variant=>integer weight stored in a column but OVERRIDDEN on read: loaded through Split.for_app_build it returns knocked-out weights (100 for the kill target / 'false', 0 elsewhere), so never save a record loaded from that scope (it is readonly). Validation enforces snake_case names/variants, integer weights, sum 100, an optional single 'appname.' prefix, and a winning 100 variant when decided. Splits are never deleted by the API: finished_at soft-retires them and Split.active filters on it. decided_at makes older assignments invisible (Assignment.excluding_decision_overrides) so a decision effectively overrides stored assignments.
