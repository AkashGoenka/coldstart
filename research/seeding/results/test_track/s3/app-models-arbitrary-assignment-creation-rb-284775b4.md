---
id: app-models-arbitrary-assignment-creation-rb-284775b4
type: file
character: single
title: "app/models/arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/arbitrary_assignment_creation.rb","symbols":["save!","supersede!","superseding?","individual_override?"],"hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.132Z
edits: 1
---

# app/models/arbitrary_assignment_creation.rb

Single writer for explicit variants. A row is superseded only when it already exists and the variant differs: the old state is copied into previous_assignments and, for a non-bulk change, individually_overridden is set, all under with_lock. A same-variant call updates the row in place and bumps updated_at with no history row, and a RecordNotUnique on first insert re-runs save! to find the row. Visitor.from_id creates the visitor when missing.
