---
id: how-a-split-weight-change-reaches-running-assignments
type: flow
title: "how a split weight change reaches running assignments"
anchors:
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/split_configs_controller.rb","hash":"sha256:3a98b6a0fcdb","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.083Z
edits: 1
---

# how a split weight change reaches running assignments

A weight change never re-buckets visitors who already have an assignment row: it changes only the registry that DeterministicAssignmentCreation and VariantCalculator read for visitors with no row yet, and the old registry is kept in previous_split_registries. Both the API (POST split_configs) and the admin split_config form go through SplitUpsert#save, which merges the posted weights over the existing variant keys (omitted variants become 0, new keys are added) and then validates the total and integer weights on Split.

## Steps

1. `app/controllers/api/v1/split_configs_controller.rb` (`create`) — API entry point; permits name and weighting_registry keys only and builds SplitUpsert for current_app
2. `app/controllers/admin/split_configs_controller.rb` (`create`) — admin entry point; permits only keys that already exist in the split registry, then builds the same SplitUpsert
3. `app/models/split_upsert.rb` (`save`, `merged_registry`) — merges posted weights over zeroed existing keys; assigns finished_at and decided_at from its own attributes, so a save without them clears both; calls reassign_weight only when the merged registry differs
4. `app/models/split.rb` (`reassign_weight`, `registry_weights_must_sum_to_100`) — validation rejects a total other than 100 or non-integer weights; reassign_weight pushes the old registry into previous_split_registries with superseded_at before overwriting
5. `app/models/deterministic_assignment_creation.rb` (`save!`) — returns early when the visitor already has a row for the split, so an existing variant keeps its weight history
6. `app/models/variant_calculator.rb` (`_variant`) — buckets a visitor with no row against the registry as it is at call time

## Invariants

- Existing Assignment rows are never re-bucketed by a weight change; only visitors without a row see the new weights.
- Any SplitUpsert save that does not pass decided_at or finished_at clears them, so a weight change un-decides a decided split (spec: 'undecides a decided split') and reactivates a finished one.
- Weights must total exactly 100 and be integers, otherwise the save returns errors (422 on the API path).
