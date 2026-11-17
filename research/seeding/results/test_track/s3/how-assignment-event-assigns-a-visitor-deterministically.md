---
id: how-assignment-event-assigns-a-visitor-deterministically
type: flow
title: "how assignment_event assigns a visitor deterministically"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.094Z
edits: 1
---

# how assignment_event assigns a visitor deterministically

The assignment_event endpoint never supersedes an existing assignment: DeterministicAssignmentCreation returns early when a row already exists for the visitor and split, and rewrites only mixpanel_result when that row is unsynced (nil or failure). For a new visitor the variant comes from VariantCalculator, which is a pure function of split name, visitor id and current weights, and ArbitraryAssignmentCreation persists it. Split lookup there is find_by! with no active scope, so a finished split still gets new rows.

## Steps

1. `app/controllers/api/v1/assignment_events_controller.rb` (`create`) — permits visitor_id, split_name, mixpanel_result and context (no variant); responds 204 with no body
2. `app/models/deterministic_assignment_creation.rb` (`save!`, `split`, `existing_assignment`) — feature-gate splits (name ends in _enabled) return before any write; existing row short-circuits; otherwise creates a row
3. `app/models/variant_calculator.rb` (`_variant`, `hash_fixnum`, `sorted_variants`) — MD5 of split name plus visitor id, first 8 hex digits mod 100, walked cumulatively over the registry keys sorted alphabetically
4. `app/models/arbitrary_assignment_creation.rb` (`save!`, `save_new_assignment!`) — writes the first row for the visitor and split (force stays false)

## Invariants

- The variant for a visitor with no row depends only on split name, visitor id and the weights at call time.
- A visitor with an existing row keeps that variant across later weight changes.
