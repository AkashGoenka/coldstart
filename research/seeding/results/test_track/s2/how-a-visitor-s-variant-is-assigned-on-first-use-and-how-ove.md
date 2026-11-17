---
id: how-a-visitor-s-variant-is-assigned-on-first-use-and-how-ove
type: flow
title: "how a visitor's variant is assigned on first use and how overrides are written"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:05.654Z
edits: 1
---

# how a visitor's variant is assigned on first use and how overrides are written

Three unauthenticated or shared-secret entry points all write through ArbitraryAssignmentCreation, but only the assignment_events path is deterministic: it hashes MD5(split.name + visitor_id) mod 100 over variants sorted by name against split.registry, and it does nothing for feature-gate splits and never changes an existing assignment's variant (only fills an unsynced mixpanel_result). The extension override (v1 assignment_overrides, BROWSER_EXTENSION_SHARED_SECRET) forces force: true and supersedes a differing variant, recording a PreviousAssignment.

## Steps

1. `app/controllers/api/v1/assignment_events_controller.rb` (`create`) — no auth filter; calls DeterministicAssignmentCreation
2. `app/models/deterministic_assignment_creation.rb` (`save!`) — skip feature gates; existing row only gets mixpanel_result; else computes variant
3. `app/models/variant_calculator.rb` (`variant`, `assignment_bucket`) — uses split.registry, which is the stored registry here (no app build)
4. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — shared-secret auth, force true
5. `app/controllers/shared_secret_authenticated_api_controller.rb` (`authenticate`) — raises if the env var is unset
6. `app/models/arbitrary_assignment_creation.rb` (`save!`, `supersede!`, `save_new_assignment!`) — insert, or supersede with history when the variant differs; retries on RecordNotUnique

## Invariants

- changing weights changes the bucket-to-variant map for new visitors only; existing assignment rows keep their variant
- a new assignment's variant must exist in split.registry (Assignment#variant_must_exist)
