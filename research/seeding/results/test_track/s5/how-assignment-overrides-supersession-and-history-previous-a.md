---
id: how-assignment-overrides-supersession-and-history-previous-a
type: flow
title: "how assignment overrides, supersession and history (previous_assignments) work"
anchors:
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","hash":"sha256:3112f28d70df","head":"435fea8235b5"}
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.846Z
edits: 1
---

# how assignment overrides, supersession and history (previous_assignments) work

Changing an existing assignment never overwrites silently: ArbitraryAssignmentCreation#supersede! locks the row, copies the old state into previous_assignments via create_previous_assignment!, then updates it. The context column records why: 'individually_overridden' (non-bulk change, or on a row already individually overridden), 'bulk_assignment' (bulk change), 'visitor_supersession'. A bulk assignment never clobbers an individually overridden row's bulk linkage. The `force` flag (set by chrome-extension override endpoints and bulk 'force') makes the assignment survive the feature-incomplete knockout in Assignment.excluding_incomplete_features_for.

## Steps

1. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — shared-secret endpoint; always force: true
2. `app/controllers/api/v2/assignment_overrides_controller.rb` (`create`) — batch variant per visitor
3. `app/models/batch_arbitrary_assignment_creation.rb` (`BatchArbitraryAssignmentCreation`) — one transaction over many ArbitraryAssignmentCreation, hardcodes mixpanel_result 'success'
4. `app/models/arbitrary_assignment_creation.rb` (`supersede!`, `individual_override?`, `context_for_supersession`) — history + context rules
5. `app/models/assignment.rb` (`create_previous_assignment!`, `previous_assignment_params`) — snapshot of the prior row

## Invariants

- Assignment variant must exist in split.registry (variant_must_exist) - overriding to an unknown variant raises
- mixpanel_result nil or 'failure' means unsynced; supersession resets nothing for individual overrides but bulk reassign sets it NULL
