---
id: app-models-split-registry-rb-ef7a24e9
type: file
character: single
title: "app/models/split_registry.rb"
anchors:
  - {"path":"app/models/split_registry.rb","symbols":["SplitRegistry","splits","experience_sampling_weight"],"hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:42.393Z
edits: 1
---

# app/models/split_registry.rb

Not a singleton: each request builds one with SplitRegistry.new(as_of:), and only v3 and v4 call valid? on it, so as_of is validated only there. splits uses Split.active(as_of:), which keeps splits retired after the timestamp, and experience_sampling_weight returns Rails.configuration's boot-time value rather than reading ENV.
