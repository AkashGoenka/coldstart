---
id: app-models-arbitrary-assignment-creation-rb-284775b4
type: file
character: single
title: "app/models/arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/arbitrary_assignment_creation.rb","symbols":["save!","superseding?","individual_override?","supersede!"],"hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.464Z
edits: 1
---

# app/models/arbitrary_assignment_creation.rb

The supersede decision (superseding?) depends only on a persisted assignment with a different variant, never on force: a supersession runs under with_lock and copies the old row to PreviousAssignment. A non-bulk supersession marks individually_overridden, sets context to 'individually_overridden', and clears bulk_assignment_id. A RecordNotUnique on insert clears the memoized assignment and calls save! again, which absorbs a concurrent create.
