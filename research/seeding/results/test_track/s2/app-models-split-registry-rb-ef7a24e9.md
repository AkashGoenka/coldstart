---
id: app-models-split-registry-rb-ef7a24e9
type: file
character: single
title: "app/models/split_registry.rb"
anchors:
  - {"path":"app/models/split_registry.rb","symbols":["SplitRegistry","splits","experience_sampling_weight"],"hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.293Z
edits: 1
---

# app/models/split_registry.rb

The as_of checks run only when a controller calls valid?: v3 and v4 pass the client's build_timestamp and render errors on failure, while v2 passes Time.zone.now and never validates. The format rule is a regex on shape only (millisecond or second precision, then offset or Z), not a parse, so the raw string is what gets bound into Split.active. With an as_of, splits() keeps splits whose finished_at is null or later than it; with nil it keeps only unfinished splits. experience_sampling_weight reads EXPERIENCE_SAMPLING_WEIGHT at boot (config/application.rb), which raises on a negative value.
