---
id: how-a-bulk-variant-change-rewrites-existing-assignments
type: flow
title: "how a bulk variant change rewrites existing assignments"
anchors:
  - {"path":"app/controllers/admin/bulk_assignments_controller.rb","hash":"sha256:50ce51ab4839","head":"435fea8235b5"}
  - {"path":"app/jobs/bulk_assignment_job.rb","hash":"sha256:db14032212ac","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/variant_retirement.rb","hash":"sha256:11cc84967538","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment.rb","hash":"sha256:eb9e01a3c749","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:48.751Z
edits: 1
---

# how a bulk variant change rewrites existing assignments

The admin POST only enqueues BulkAssignmentJob, so the redirect shows success before any assignment row changes. The job runs BulkAssignmentCreation.save inside an Assignment transaction, and that transaction calls BulkReassignment.create! for the already-assigned visitors, which is set-based SQL, not one save per row. VariantRetirement reuses BulkReassignment in the same way, with its own bulk_assignment per target variant.

## Steps

1. `app/controllers/admin/bulk_assignments_controller.rb` (`create`, `enqueue_assignments`) — validates BulkAssignmentCreation, then perform_later with the params; the actual work is not in the request
2. `app/jobs/bulk_assignment_job.rb` (`perform`) — builds BulkAssignmentCreation from the params and calls save!
3. `app/models/bulk_assignment_creation.rb` (`save`, `existing_assignments`, `assignment_creations`) — inside Assignment.transaction: saves the BulkAssignment, runs BulkReassignment for existing assignments, then creates ArbitraryAssignmentCreation for the rest
4. `app/models/bulk_reassignment.rb` (`save`, `insert_previous_assignments`, `update_assignments`, `assignment_id_clause`) — copies current rows into previous_assignments, then UPDATEs variant, mixpanel_result = NULL and context; runs under with_transactional_lock('bulk_reassignment')
5. `app/models/variant_retirement.rb` (`save!`, `create_bulk_assignment_for_variant`) — second caller: splits a retiring variant's assignment ids across active variants by weight and calls BulkReassignment per target
6. `app/models/bulk_assignment.rb` (`has_many :assignments`) — the audit row each reassignment points at; BulkReassignment borrows its connection and lock helper from it

## Invariants

- existing_assignments skips a row only when it already has the same variant AND the same force value; a row with the same variant but a different force is reassigned.
- BulkReassignment takes timestamps from bulk_assignment.created_at, not Time.now, so every row in one bulk action carries the same time.
- An empty assignments list writes nothing: assignment_id_clause becomes IS NULL, and the spec 'reassigns nothing with an empty array' covers it.
- Reassignment clears mixpanel_result to NULL, so the reassigned rows are unsynced until the sync runs again.
