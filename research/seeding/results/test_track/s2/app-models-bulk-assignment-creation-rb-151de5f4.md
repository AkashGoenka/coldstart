---
id: app-models-bulk-assignment-creation-rb-151de5f4
type: file
character: single
title: "app/models/bulk_assignment_creation.rb"
anchors:
  - {"path":"app/models/bulk_assignment_creation.rb","symbols":["BulkAssignmentCreation","most_identifiers_must_exist","ensure_identifiers","existing_assignments"],"hash":"sha256:c33166c887cc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:34.020Z
edits: 1
---

# app/models/bulk_assignment_creation.rb

The admin form only calls `valid?` and then enqueues `BulkAssignmentJob`, which calls `save!` again in the worker, so the form's validation is a snapshot and the job can still raise. `save` runs inside `Assignment.transaction`, and `ensure_identifiers` (reached from `existing_assignments` and `unassigned_identifiers`, not from validation) creates a Visitor and Identifier for every unknown value, so those creations roll back with a failed run. `most_identifiers_must_exist` refuses a listing where more than 2% would create new identifiers unless `force_identifier_creation` is set, but its denominator is the raw `ids_to_assign` size, which is not de-duplicated, so repeated values lower the ratio and can hide the warning. `existing_assignments` takes this split's assignments for listed visitors whose variant or `force` differ and passes them to `BulkReassignment.create!`; this class does not change those rows itself and creates `ArbitraryAssignmentCreation` only for listed visitors with no assignment on the split.
