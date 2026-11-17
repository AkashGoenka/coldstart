---
id: app-models-decision-rb-33818547
type: file
character: single
title: "app/models/decision.rb"
anchors:
  - {"path":"app/models/decision.rb","symbols":["Decision","save!"],"hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:14.212Z
edits: 1
---

# app/models/decision.rb

Decision has no save method: `save!` is the only write, and it calls split.reconfigure! with {variant => 100} and decided_at now. Its ActiveModel presence validations never run because save! does not call valid?. A variant missing from the split raises a plain RuntimeError before anything is written. Since SplitUpsert zeroes the other variants, a decision is a 100/0 reweight, so it also writes a PreviousSplitRegistry row.
