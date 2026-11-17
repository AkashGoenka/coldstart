---
id: app-models-variant-retirement-rb-7b219332
type: file
character: single
title: "app/models/variant_retirement.rb"
anchors:
  - {"path":"app/models/variant_retirement.rb","symbols":["VariantRetirement","save!","retiring_assignments"],"hash":"sha256:11cc84967538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.799Z
edits: 1
---

# app/models/variant_retirement.rb

A retirement moves rows and never writes the split registry: the retiring variant keeps its weight in what the API serves. Rows come from split.assignments, so rows hidden by a decision are not touched. Each row gets an independent SecureRandom draw indexed into a gradient built from the positive weights, so the distribution is weighted but not deterministic per row. Batches are created inside one Assignment transaction, and each batch is a BulkAssignment plus a BulkReassignment.
