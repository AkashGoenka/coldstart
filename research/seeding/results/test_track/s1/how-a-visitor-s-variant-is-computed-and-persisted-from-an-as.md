---
id: how-a-visitor-s-variant-is-computed-and-persisted-from-an-as
type: flow
title: "how a visitor's variant is computed and persisted from an assignment event"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
  - {"path":"app/models/deterministic_assignment_creation.rb","hash":"sha256:915c6ddf264d","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/variant_calculator.rb","hash":"sha256:431bbaf12b85","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.903Z
edits: 1
---

# how a visitor's variant is computed and persisted from an assignment event

The server computes a variant only to seed a visitor's first assignment: POST assignment_event hashes split name plus visitor id into one of 100 buckets, and that variant is written only when no assignment row exists yet. Every other request changes nothing except, at most, the mixpanel_result of an unsynced row. The variant the client sends is never read, and the endpoint returns 204 whichever branch ran. The weights used are the stored registry, not the app-build-scoped knockouts.

## Steps

1. `app/controllers/api/v1/assignment_events_controller.rb` (`create`, `create_params`) — Permits only visitor_id, split_name, mixpanel_result and context, so a client-sent variant is dropped; no rescue is declared, so unknown split names and invalid mixpanel_result values surface as errors.
2. `app/models/visitor.rb` (`from_id`) — find_or_create_by! the posted id; a RecordNotUnique race falls back to find.
3. `app/models/deterministic_assignment_creation.rb` (`save!`, `existing_assignment`) — Returns early for feature gates. With an existing assignment it only sets mixpanel_result, and only when unsynced, saving with touch: false. Without one it passes the calculated variant to ArbitraryAssignmentCreation.
4. `app/models/split.rb` (`registry`) — Returns the stored weights. Remote-kill and feature-incomplete knockouts apply only to rows loaded through the for_app_build scope, and this path loads the split with Split.find_by!.
5. `app/models/variant_calculator.rb` (`_variant`, `split_visitor_hash`) — Bucket = first 8 hex chars of MD5(split name + visitor id) mod 100. The first variant, in sorted-key order, whose cumulative weight exceeds the bucket wins.
6. `app/models/arbitrary_assignment_creation.rb` (`save!`, `save_new_assignment!`) — Inserts the row. On RecordNotUnique it retries save!, and that retry is the only way this path can reach a supersede.
7. `app/models/assignment.rb` (`unsynced?`) — mixpanel_result is limited to success or failure. nil or failure counts as unsynced, which is the only condition under which this path writes to an existing row.

## Invariants

- An existing assignment's variant is never changed by assignment_event; only its mixpanel_result can change, and only while it is unsynced.
- Feature gates (split rows whose feature_gate column is true, set on upsert from a name ending in _enabled) are never persisted, yet the endpoint still returns 204.
- The bucket input is split name + visitor id with no separator, and weights are read as stored. Changing weights moves only visitors who have no assignment yet, and renaming a split changes its bucket for every visitor.
- Sync writes use touch: false so updated_at is not bumped, because excluding_decision_overrides compares assignments.updated_at against splits.decided_at.
