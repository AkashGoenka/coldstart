---
id: app-models-split-registry-rb-ef7a24e9
type: file
character: single
title: "app/models/split_registry.rb"
anchors:
  - {"path":"app/models/split_registry.rb","symbols":["SplitRegistry","splits"],"hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.934Z
edits: 1
---

# app/models/split_registry.rb

Not an AR model: a value object that serves the as_of registry used by v3/v4. `as_of` must be an ISO8601 string with zone (validation regex), and splits = Split.active(as_of:), i.e. splits finished AFTER the build timestamp are still listed. v2 passes Time.zone.now (a Time, no validation issue) while v3/v4 pass the raw client string. Not to be confused with the registry column on Split or PreviousSplitRegistry (history rows).
