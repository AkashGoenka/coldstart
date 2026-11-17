---
id: how-the-v2-migrations-api-applies-decisions-retirements-remo-2
type: flow
title: "how the v2 migrations API applies decisions, retirements, remote kills and feature completions"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_api_controller.rb","hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/split_decisions_controller.rb","hash":"sha256:40a692d7b2a7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/split_retirements_controller.rb","hash":"sha256:52f168361fef","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/app_remote_kills_controller.rb","hash":"sha256:67bc2acd143b","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/app_feature_completions_controller.rb","hash":"sha256:bf22d4986ee6","head":"435fea8235b5"}
  - {"path":"app/models/split_decision_migration.rb","hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
  - {"path":"app/models/split_retirement_migration.rb","hash":"sha256:f1ab7ab023a4","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill_migration.rb","hash":"sha256:5cb3a8785f67","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion_migration.rb","hash":"sha256:f9a8a9ed3c53","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: retracted
updated: 2026-11-16T18:25:00.210Z
edits: 2
---

# how the v2 migrations API applies decisions, retirements, remote kills and feature completions

> Retracted — kept for history; do not rely on this note.

The remote-kill and feature-completion endpoints look up their split with Split.find_by(name:) and no owner_app scope, while the decision and retirement endpoints scope it to the calling app; and a remote kill never edits the split's registry, it rewrites the presented registry at read time for matching builds (Split#registry). A decision or retirement does write the stored registry: it sets the winning variant to 100 and stamps decided_at, and retirement also stamps finished_at, which drops the split out of Split.active. Blank first_bad_version or version (nil or empty string, tested before type cast) turns a remote-kill or feature-completion request into a delete.

## Steps

1. `config/routes.rb` (`migrations`) — POST under /api/v2/migrations/ with singular resource names (app_remote_kill, app_feature_completion, split_decision, split_retirement) that Rails maps to the plural Migrations controllers
2. `app/controllers/authenticated_api_controller.rb` (`authenticate`) — HTTP basic: App.find_by(name:) and a constant-time compare of auth_secret sets current_app, otherwise 401
3. `app/controllers/api/v2/migrations/split_decisions_controller.rb` (`create`) — builds SplitDecisionMigration with app: current_app, returns 204 on save or 422 with the wrapper's errors (the other three controllers follow the same shape)
4. `app/models/split_decision_migration.rb` (`SplitDecisionMigration`, `split_model`) — validates the split belongs to the app and the variant exists, then split.create_decision!
5. `app/models/decision.rb` (`Decision`, `save!`) — calls split.reconfigure! with weighting {variant=>100} and decided_at = now
6. `app/models/split.rb` (`reconfigure!`, `create_decision!`, `knock_out_weightings`) — reconfigure! goes through SplitUpsert; the stored registry is not knocked out here, only the read path is
7. `app/models/split_upsert.rb` (`SplitUpsert`, `save`) — assigns finished_at and decided_at from its accessors, so any value not passed becomes nil; the write also archives the old registry via reassign_weight
8. `app/models/app_remote_kill_migration.rb` (`AppRemoteKillMigration`, `destroy?`) — blank first_bad_version deletes the matching AppRemoteKill (split + reason); otherwise saves it, so the request upserts by split + reason
9. `app/models/app_remote_kill.rb` (`AppRemoteKill`, `affecting`, `must_not_overlap_existing`) — affecting limits the kill to the app's builds in [first_bad_version, fixed_version); overlap with another kill of the same split is rejected
10. `app/models/split.rb` (`with_remote_kill_knockouts_for`, `registry`) — read time: for a given app build the registry is rewritten so override_to gets 100 and the rest 0; the stored weights are left alone
11. `app/models/assignment.rb` (`excluding_decision_overrides`, `for_presentation`) — assignments whose updated_at is at or before the split's decided_at are hidden from presentation

## Invariants

- decided_at and finished_at are cleared by any write that omits them, because SplitUpsert defaults them to nil: a decision on a retired split reactivates it (spec/models/split_decision_migration_spec.rb asserts finished_at is nil afterwards).
- A remote kill's override_to is only checked for presence; a value that is not a variant of the split is logged by log_knockout_error and the registry is served unchanged.
- Delete requests are idempotent: deleting a feature completion that does not exist returns success (spec/models/app_feature_completion_migration_spec.rb, 'is valid when destroying an unpersisted feature completion for idempotency').
- A split is only hidden from presentation by retirement (finished_at past as_of); a build's as_of is its built_at, so builds made before retirement keep seeing the split.
