---
id: app-models-variant-calculator-rb-40367afb
type: file
character: single
title: "app/models/variant_calculator.rb"
anchors:
  - {"path":"app/models/variant_calculator.rb","symbols":["_variant","split_visitor_hash","assignment_bucket"],"hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:28.958Z
edits: 2
---

# app/models/variant_calculator.rb

The bucket is the first 8 hex chars of MD5(split.name + visitor_id.to_s), read as an integer and taken mod 100, with no separator between name and id. Variants are walked in sorted-key order (weighting.keys.sort) and the first whose cumulative weight exceeds the bucket wins; the registry validation requires weights to sum to 100, so every bucket resolves. The weighting is split.registry as stored. The initializer destructively deletes its opts, and unknown keys raise.
