---
id: how-a-bulk-assignment-supersedes-existing-assignments
type: flow
title: "how a bulk assignment supersedes existing assignments"
anchors:
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/previous_assignment.rb","hash":"sha256:8f19e3251627","head":"435fea8235b5"}
  - {"path":"app/jobs/bulk_assignment_job.rb","hash":"sha256:db14032212ac","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.587Z
edits: 1
---

# how a bulk assignment supersedes existing assignments

The snapshot rows in previous_assignments copy the superseded assignment's own bulk_assignment_id, so that column names the bulk that created the old value, while superseded_at and the rewritten bulk_assignment_id come from the new bulk. BulkAssignmentCreation#save runs the bulk row, the snapshot, the UPDATE and the new-visitor inserts in one Assignment.transaction, and rows already at the requested variant and force are left out of the superseded set. Failures surface differently: save returns false, save! raises ActiveRecord::RecordInvalid, but BulkReassignment#save! raises a plain string.

## Steps

1. `app/models/bulk_assignment_creation.rb` (`save`, `existing_assignments`, `assignment_creations`) — Entry point: validates, opens the transaction, creates the bulk row, calls BulkReassignment.create! with the existing assignments that differ in variant or force, then saves one ArbitraryAssignmentCreation per identifier with no assignment on this split.
2. `app/models/bulk_reassignment.rb` (`insert_previous_assignments`, `update_assignments`) — Raw SQL: INSERTs a previous_assignments snapshot for each superseded row, then UPDATEs the row to the new variant, force, context 'bulk_assignment' and bulk_assignment_id, with mixpanel_result reset to NULL.
3. `app/models/assignment.rb` (`previous_assignment_params`, `create_previous_assignment!`) — Ruby-side version of the same snapshot field list (variant, bulk_assignment_id, individually_overridden, visitor_supersession_id, context, force); the bulk SQL copies this set of columns.
4. `app/models/arbitrary_assignment_creation.rb` (`ArbitraryAssignmentCreation`, `save!`) — Carries bulk_assignment_id and force onto each new assignment; save! either creates the assignment or takes the superseding branch.
5. `app/models/previous_assignment.rb` (`PreviousAssignment`) — Row shape: requires variant and superseded_at, and optionally links to bulk_assignment and visitor_supersession.
6. `app/jobs/bulk_assignment_job.rb` (`BulkAssignmentJob`, `perform`) — Background wrapper: runs BulkAssignmentCreation#save! on the params hash, so a validation failure raises out of the job.

## Invariants

- Only assignments whose variant or force differ from the requested pair are superseded; identical rows are not snapshotted.
- The snapshot INSERT and the UPDATE both run inside BulkReassignment's lock, and both use the bulk's created_at as superseded_at.
- A failure in any step rolls back the bulk row, the snapshots, the updates and the new assignments together.
