---
id: how-a-visitor-gets-assigned-a-variant-of-a-split
type: flow
title: "how a visitor gets assigned a variant of a split"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:34.043Z
edits: 1
---

# how a visitor gets assigned a variant of a split

The deterministic path never stores a variant before computing it and never changes an existing one: the variant is hashed only when the visitor has no Assignment row for that split, and an existing row only gets its mixpanel_result refreshed (when unsynced). The decision lives in DeterministicAssignmentCreation, not in the controller, which only permits params and returns 204. The actual write is delegated to ArbitraryAssignmentCreation.

## Steps

1. `app/controllers/api/v1/assignment_events_controller.rb` (`create`, `create_params`) — POST handler; permits visitor_id, split_name, mixpanel_result and context (not variant), calls DeterministicAssignmentCreation.create! and returns 204.
2. `app/models/deterministic_assignment_creation.rb` (`save!`, `existing_assignment`) — returns early for feature-gate splits; if an Assignment exists for visitor+split it only refreshes mixpanel_result when unsynced; otherwise asks VariantCalculator for the variant and creates through ArbitraryAssignmentCreation.
3. `app/models/variant_calculator.rb` (`_variant`, `split_visitor_hash`) — bucket = first 8 hex chars of MD5(split.name + visitor_id) mod 100; walks the registry keys in sorted order, accumulating weights, and returns the first variant whose running total exceeds the bucket.
4. `app/models/arbitrary_assignment_creation.rb` (`save_new_assignment!`) — find_or_initialize the Assignment for visitor+split and save it; on ActiveRecord::RecordNotUnique it clears the memoized assignment and calls save! again.

## Invariants

- Split registry weights must sum to 100 and be integers (Split validations), so every bucket 0-99 falls inside some variant.
- The split name is hashed together with the visitor id, so one visitor gets independent buckets for different splits.
- Variant keys are sorted as strings before weighting, so reordering the registry hash does not move anyone; renaming a key can.
- Once a row exists, changing a split's registry does not reassign that visitor through this path.
