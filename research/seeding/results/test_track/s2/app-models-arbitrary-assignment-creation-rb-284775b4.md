---
id: app-models-arbitrary-assignment-creation-rb-284775b4
type: file
character: single
title: "app/models/arbitrary_assignment_creation.rb"
anchors:
  - {"path":"app/models/arbitrary_assignment_creation.rb","symbols":["ArbitraryAssignmentCreation","save!","supersede!","save_new_assignment!","bulk_assignment_id_for_save","individual_override?"],"hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.983Z
edits: 1
---

# app/models/arbitrary_assignment_creation.rb

`save!` supersedes only when the assignment row exists and the variant differs (`superseding?`); otherwise it updates the row in place and writes no PreviousAssignment. Supersession creates the PreviousAssignment and updates the row inside `with_lock`, but the variant comparison runs before the lock and is not repeated inside it. `bulk_assignment_id_for_save` keeps the row's existing bulk_assignment_id and uses the incoming one only when the row has none. `individually_overridden` is sticky: once true, a later bulk supersession keeps it and sets context to 'individually_overridden', while a non-bulk supersession clears the bulk id to nil. The RecordNotUnique rescue in `save_new_assignment!` clears `@assignment` and calls `save!` again so the racing insert is picked up as an existing row.
