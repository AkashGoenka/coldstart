---
id: app-models-split-registry-rb-ef7a24e9
type: file
character: single
title: "app/models/split_registry.rb"
anchors:
  - {"path":"app/models/split_registry.rb","symbols":["SplitRegistry","splits"],"hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.792Z
edits: 1
---

# app/models/split_registry.rb

The as_of regex checks shape only. It accepts month 00 to 19 and day 00 to 39, so impossible dates pass; it leaves the decimal point unescaped, so any character works there; it allows fractional seconds of any length; and it accepts only Z or a +hh:mm/-hh:mm zone, so -0400 fails. The comment above the regex says this is deliberate: clients should send high-precision ISO timestamps, and millisecond and second precision are both allowed. splits passes as_of straight to Split.active, so an as_of that skips validation is compared against finished_at unchanged.
