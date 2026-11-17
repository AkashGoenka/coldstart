---
id: app-models-variant-calculator-rb-40367afb
type: file
character: single
title: "app/models/variant_calculator.rb"
anchors:
  - {"path":"app/models/variant_calculator.rb","symbols":["VariantCalculator","_variant","sorted_variants","split_visitor_hash","hash_fixnum"],"hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.137Z
edits: 2
---

# app/models/variant_calculator.rb

Bucket = first 8 hex digits of MD5(split name + visitor id) mod 100, walked cumulatively over the registry keys sorted alphabetically, not in stored order. It reads split.registry when called, so a weight change affects only visitors that reach it (new visitors). Constructor raises when visitor_id or split is missing.
