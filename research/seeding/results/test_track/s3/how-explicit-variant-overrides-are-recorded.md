---
id: how-explicit-variant-overrides-are-recorded
type: flow
title: "how explicit variant overrides are recorded"
anchors:
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","hash":"sha256:3112f28d70df","head":"435fea8235b5"}
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.100Z
edits: 1
---

# how explicit variant overrides are recorded

Both override endpoints pass force: true and skip VariantCalculator entirely: they write the given variant through ArbitraryAssignmentCreation, which supersedes an existing row only when its variant differs. The batch endpoint runs every assignment inside one ActiveRecord transaction and hard-codes mixpanel_result to 'success' because it does not accept that param.

## Steps

1. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — single override under the shared-secret auth base; permits mixpanel_result and calls ArbitraryAssignmentCreation.create! with force true
2. `app/controllers/api/v2/assignment_overrides_controller.rb` (`create`) — batch override for one visitor; permits an assignments array of split_name, variant, context and forces force true
3. `app/models/batch_arbitrary_assignment_creation.rb` (`save!`) — wraps each assignment in one transaction and merges visitor_id, force and mixpanel_result 'success'
4. `app/models/arbitrary_assignment_creation.rb` (`save!`, `supersede!`, `superseding?`, `individual_override?`) — supersedes only when a persisted row has a different variant; same-variant calls update the row in place

## Invariants

- A same-variant override bumps updated_at and writes no history row; updated_at is what the decision filter compares against.
- Visitor.from_id creates the visitor row when it does not exist.
- A superseding override copies the old row into previous_assignments under with_lock.
