---
id: how-bulk-assignment-from-the-admin-ui-runs-job-transaction-l
type: flow
title: "how bulk assignment from the admin UI runs (job, transaction lock, reassignment SQL)"
anchors:
  - {"path":"app/controllers/admin/bulk_assignments_controller.rb","hash":"sha256:50ce51ab4839","head":"435fea8235b5"}
  - {"path":"app/jobs/bulk_assignment_job.rb","hash":"sha256:db14032212ac","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/variant_retirement.rb","hash":"sha256:11cc84967538","head":"435fea8235b5"}
  - {"path":"config/application.rb","hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
  - {"path":"Procfile","hash":"sha256:82fa384146f1","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.867Z
edits: 1
---

# how bulk assignment from the admin UI runs (job, transaction lock, reassignment SQL)

Admin bulk assignment is asynchronous: Admin::BulkAssignmentsController validates, then enqueues BulkAssignmentJob (delayed_job, the `worker` process in Procfile - nothing happens in dev/prod without `rake jobs:work`) with params including the Admin and Split AR objects serialized by GlobalID. The job re-runs BulkAssignmentCreation#save! inside one Assignment.transaction: unknown identifiers are created along with new Visitors (guarded by a >2% new-identifier ratio check unless force_identifier_creation), existing differing assignments are snapshotted by raw SQL in BulkReassignment under a with_transactional_lock('bulk_reassignment') advisory lock, and the rest are created via ArbitraryAssignmentCreation. VariantRetirement reuses BulkReassignment to randomly redistribute a retiring variant's visitors across active variants by weight.

## Steps

1. `app/controllers/admin/bulk_assignments_controller.rb` (`create`, `enqueue_assignments`) — validates then perform_later; success flash only means 'enqueued'
2. `app/jobs/bulk_assignment_job.rb` (`BulkAssignmentJob`) — calls save! (raises on invalid)
3. `app/models/bulk_assignment_creation.rb` (`BulkAssignmentCreation`, `ensure_identifiers`, `existing_assignments`, `unassigned_identifiers`) — orchestrates; identifiers_listing split on whitespace/commas
4. `app/models/bulk_reassignment.rb` (`BulkReassignment`, `insert_previous_assignments`, `update_assignments`) — set-based SQL that bypasses AR callbacks and sets mixpanel_result NULL, context 'bulk_assignment'
5. `app/models/variant_retirement.rb` (`VariantRetirement`) — admin variant retirement via bulk reassignment

## Invariants

- config.active_job.queue_adapter = :delayed_job and enqueue_after_transaction_commit = :never
- bulk 'force' flag is stored on bulk_assignments and copied to assignments
