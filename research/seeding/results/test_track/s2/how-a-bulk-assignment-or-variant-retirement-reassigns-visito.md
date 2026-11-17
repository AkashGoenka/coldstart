---
id: how-a-bulk-assignment-or-variant-retirement-reassigns-visito
type: flow
title: "how a bulk assignment or variant retirement reassigns visitors"
anchors:
  - {"path":"app/controllers/admin/bulk_assignments_controller.rb","hash":"sha256:50ce51ab4839","head":"435fea8235b5"}
  - {"path":"app/jobs/bulk_assignment_job.rb","hash":"sha256:db14032212ac","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/variant_retirement.rb","hash":"sha256:11cc84967538","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:05.641Z
edits: 1
---

# how a bulk assignment or variant retirement reassigns visitors

Both the admin bulk-assign form and variant retirement end in BulkReassignment, which rewrites assignments with raw SQL (INSERT previous_assignments then UPDATE), so Assignment validations such as variant_must_exist and ArbitraryAssignmentCreation's individual-override logic are bypassed for existing rows. The admin controller only runs valid? and enqueues BulkAssignmentJob with the params (plus admin and split objects); the job re-runs BulkAssignmentCreation#save!, where one Assignment.transaction creates the BulkAssignment, reassigns existing rows with a different variant or force, then uses ArbitraryAssignmentCreation only for visitors with no assignment on the split.

## Steps

1. `app/controllers/admin/bulk_assignments_controller.rb` (`create`, `enqueue_assignments`) — validates then perform_later; no data is written in the request
2. `app/jobs/bulk_assignment_job.rb` (`perform`) — calls BulkAssignmentCreation.new(params).save!
3. `app/models/bulk_assignment_creation.rb` (`save`, `existing_assignments`, `unassigned_identifiers`, `ensure_identifiers`) — creates unknown identifiers and visitors, splits listed visitors into reassign vs new
4. `app/models/bulk_reassignment.rb` (`save`, `insert_previous_assignments`, `update_assignments`) — history insert then update under a transactional lock; timestamps use bulk_assignment.created_at; mixpanel_result cleared so the change is re-synced
5. `app/models/arbitrary_assignment_creation.rb` (`save!`, `supersede!`) — creates new assignments tagged with bulk_assignment_id and context bulk_assignment
6. `app/models/variant_retirement.rb` (`save!`, `random_active_variant`) — synchronous path: for each retiring-variant assignment picks a random positive-weight variant by weight, makes one BulkAssignment per target variant and calls BulkReassignment.create! with assignment ids

## Invariants

- BulkAssignment must be saved before BulkReassignment runs (it supplies id, variant, force and the timestamp)
- previous_assignments insert must precede the update
- VariantRetirement targets are drawn from split.assignments, i.e. the for_presentation scope, so decision-hidden assignments are not retired
