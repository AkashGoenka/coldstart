---
id: how-a-visitor-s-variant-is-assigned-deterministic-hash-bucke
type: flow
title: "how a visitor's variant is assigned (deterministic hash bucket and persistence)"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.841Z
edits: 1
---

# how a visitor's variant is assigned (deterministic hash bucket and persistence)

A variant is not stored until the client reports it: clients compute nothing from the server's assignments table for new splits; they POST /api/v1/assignment_event and the server derives the variant as md5(split.name + visitor_id) first 8 hex chars mod 100, walking variants in SORTED name order accumulating weights. Because order and hash are fixed, changing a split's weights moves visitors only at bucket boundaries, and renaming a split or variant order changes everyone's bucket. Feature gates (names ending _enabled) never get deterministic assignments: DeterministicAssignmentCreation returns silently for them.

## Steps

1. `app/controllers/api/v1/assignment_events_controller.rb` (`create`) — unauthenticated entry; returns 204 always
2. `app/models/deterministic_assignment_creation.rb` (`DeterministicAssignmentCreation`, `save!`) — no-op for feature gates; if assignment exists only updates mixpanel_result when unsynced; else computes variant and delegates
3. `app/models/variant_calculator.rb` (`VariantCalculator`, `assignment_bucket`) — MD5 bucket over sorted variant names using split.registry weights
4. `app/models/arbitrary_assignment_creation.rb` (`ArbitraryAssignmentCreation`) — actual writer; creates or supersedes, retries on RecordNotUnique

## Invariants

- assignments has a unique index on (split_id, visitor_id) - concurrency is handled by rescuing RecordNotUnique and retrying
- Split.registry (possibly knocked-out per build) is what VariantCalculator reads
