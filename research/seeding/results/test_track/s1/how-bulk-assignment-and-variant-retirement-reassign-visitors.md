---
id: how-bulk-assignment-and-variant-retirement-reassign-visitors
type: flow
title: "how bulk assignment and variant retirement reassign visitors"
anchors:
  - {"path":"app/controllers/admin/bulk_assignments_controller.rb","hash":"sha256:50ce51ab4839","head":"435fea8235b5"}
  - {"path":"app/jobs/bulk_assignment_job.rb","hash":"sha256:db14032212ac","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/variant_retirements_controller.rb","hash":"sha256:13e2caf1a708","head":"435fea8235b5"}
  - {"path":"app/models/variant_retirement.rb","hash":"sha256:11cc84967538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.470Z
edits: 1
---

# how bulk assignment and variant retirement reassign visitors

The admin form's validation is only a preview: the delayed job re-runs the same check, and it is the job that creates the Visitor and Identifier rows and moves the assignments. Visitors who already have a row are rewritten by raw SQL in BulkReassignment, not by ArbitraryAssignmentCreation, and variant retirement skips the form and the 2% guard and reuses BulkReassignment. The request only says 'Enqueued'; nothing has moved yet when the admin sees the redirect.

## Steps

1. `app/controllers/admin/bulk_assignments_controller.rb` (`create`, `enqueue_assignments`) — Request-time check (valid? counts identifiers, creates none), then perform_later with the params hash, which includes the admin and split records. Invalid input re-renders the form.
2. `app/jobs/bulk_assignment_job.rb` (`perform`) — Runs later under delayed_job and calls save!; a validation failure found at this point raises instead of reaching the admin.
3. `app/models/bulk_assignment_creation.rb` (`save`, `existing_assignments`, `assignment_creations`) — One Assignment.transaction: save the BulkAssignment, call BulkReassignment for visitors whose identifier already existed, then save an ArbitraryAssignmentCreation per visitor with no row yet. Unknown identifiers and visitors are created inside this transaction.
4. `app/models/bulk_reassignment.rb` (`save`, `insert_previous_assignments`, `update_assignments`) — Under with_transactional_lock('bulk_reassignment'), copies the rows into previous_assignments, then UPDATEs assignments with raw SQL. No callbacks or validations run.
5. `app/models/arbitrary_assignment_creation.rb` (`save!`, `save_new_assignment!`) — For bulk, only the insert branch runs, because the visitor had no row. The supersede branch is reached only after a RecordNotUnique retry.
6. `app/controllers/admin/variant_retirements_controller.rb` (`create`) — Retirement entry point: VariantRetirement.create! with the split id and retiring variant. No identifier guard and no force parameter.
7. `app/models/variant_retirement.rb` (`save!`, `random_active_variant`) — Draws one target per retiring row from the weight gradient, creates one BulkAssignment per target that received rows, and passes each group to BulkReassignment inside one transaction.

## Invariants

- The 2% new-identifier guard runs at enqueue time and again inside the job, so an enqueued job can fail after the admin was told it succeeded.
- Rows whose variant and force already match the target are excluded by existing_assignments and keep their previous_assignments history untouched.
- BulkReassignment writes force from bulk_assignment.force, so a reassignment whose BulkAssignment has force false clears force on rows that had it, which variant retirement always does.
- previous_assignments rows and the assignment UPDATE share one transaction, so a failure rolls back both.
