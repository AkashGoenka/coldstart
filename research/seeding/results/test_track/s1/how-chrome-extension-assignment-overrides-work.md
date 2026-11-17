---
id: how-chrome-extension-assignment-overrides-work
type: flow
title: "how chrome-extension assignment overrides work"
anchors:
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","hash":"sha256:3112f28d70df","head":"435fea8235b5"}
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/bulk_assignment_creation.rb","hash":"sha256:c33166c887cc","head":"435fea8235b5"}
  - {"path":"app/models/bulk_reassignment.rb","hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:10.080Z
edits: 1
---

# how chrome-extension assignment overrides work

The override flag does not protect a row from bulk reassignment: BulkReassignment's raw SQL UPDATE rewrites the variant of an individually overridden row and leaves individually_overridden true, so the row keeps the flag while holding a bulk variant. Overrides arrive through the shared-secret API controllers as ArbitraryAssignmentCreation with force: true and no bulk id; when a persisted row's variant changes it is superseded, not updated, which archives the old row into previous_assignments and sets individually_overridden on the live row. The v2 endpoint wraps its whole batch in one transaction and hardcodes mixpanel_result to 'success'.

## Steps

1. `app/controllers/shared_secret_authenticated_api_controller.rb` (`SharedSecretAuthenticatedApiController`) — before_action gate: HTTP Basic password checked against BROWSER_EXTENSION_SHARED_SECRET; raises rather than 401 when the variable is unset
2. `app/controllers/api/v1/assignment_overrides_controller.rb` (`Api::V1::AssignmentOverridesController`, `create`) — single-assignment override: merges force: true and calls ArbitraryAssignmentCreation.create!
3. `app/controllers/api/v2/assignment_overrides_controller.rb` (`Api::V2::AssignmentOverridesController`, `create`) — batch override: merges force: true and calls BatchArbitraryAssignmentCreation.create!
4. `app/models/batch_arbitrary_assignment_creation.rb` (`BatchArbitraryAssignmentCreation`, `save!`) — fans the batch out one ArbitraryAssignmentCreation at a time inside a single transaction, forcing mixpanel_result 'success'
5. `app/models/arbitrary_assignment_creation.rb` (`ArbitraryAssignmentCreation`, `save!`, `superseding?`, `individual_override?`, `supersede!`) — decides supersede vs plain upsert; a changed variant on an existing row goes through supersede! under with_lock
6. `app/models/assignment.rb` (`Assignment`, `create_previous_assignment!`, `previous_assignment_params`) — archives the live row into previous_assignments before the update, copying its current individually_overridden and bulk_assignment_id
7. `app/models/bulk_assignment_creation.rb` (`BulkAssignmentCreation`, `existing_assignments`, `save`) — bulk path: selects existing rows whose variant differs (does not exclude flagged rows), runs BulkReassignment, then creates assignments for unassigned identifiers
8. `app/models/bulk_reassignment.rb` (`BulkReassignment`, `update_assignments`, `insert_previous_assignments`) — raw SQL archive plus UPDATE that sets variant and context 'bulk_assignment' without touching individually_overridden

## Invariants

- individually_overridden is set only by supersede_attrs, i.e. only on a write that supersedes a persisted row and is either an unbulked write or a write onto an already flagged row
- A bulk write onto a flagged row through ArbitraryAssignmentCreation stays individual (individual_override? is true), but a bulk write through BulkReassignment overwrites the variant regardless of the flag
- previous_assignments copies the live row before the update, so an archived row carries the flag and bulk_assignment_id that were in force before the override
- Both extension controllers merge force: true; v1 passes the client's mixpanel_result through, v2 never reads it
