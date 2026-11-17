---
id: app-models-variant-retirement-rb-7b219332
type: file
character: single
title: "app/models/variant_retirement.rb"
anchors:
  - {"path":"app/models/variant_retirement.rb","symbols":["save!","random_active_variant"],"hash":"sha256:11cc84967538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.508Z
edits: 1
---

# app/models/variant_retirement.rb

Spreads the retiring variant's rows across the other active variants. Each row draws one of 100 slots from a gradient built from registry weights, with zero-weight variants excluded; this matches the weights because Split requires registry weights to sum to 100. Each target that receives rows gets its own BulkAssignment, reason `Retiring <variant>`, with force left false, and each group goes through BulkReassignment in one transaction. Nothing in this file checks that the retiring variant's own weight is 0, so if it is still positive it can be drawn back as a target. There is no 2% guard and no sync validation here.
