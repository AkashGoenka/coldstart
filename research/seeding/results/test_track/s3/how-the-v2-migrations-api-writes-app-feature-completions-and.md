---
id: how-the-v2-migrations-api-writes-app-feature-completions-and
type: flow
title: "how the v2 migrations API writes app feature completions and remote kills"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/app_feature_completions_controller.rb","hash":"sha256:bf22d4986ee6","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/app_remote_kills_controller.rb","hash":"sha256:67bc2acd143b","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_api_controller.rb","hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion_migration.rb","hash":"sha256:f9a8a9ed3c53","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill_migration.rb","hash":"sha256:5cb3a8785f67","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.679Z
edits: 1
---

# how the v2 migrations API writes app feature completions and remote kills

Both endpoints are POST-only upserts keyed differently, and a blank version (feature completion) or blank first_bad_version (remote kill) turns the same POST into a delete: completions are keyed on (app, feature gate), remote kills on (app, split, reason). The app comes from HTTP basic auth (app name and auth_secret), never from the body. Success returns 204 with no body, and failure returns 422 with the model's errors as JSON.

## Steps

1. `config/routes.rb` (`migrations`) — Declares the migration endpoints under api/v2 with module scope to Api::V2::Migrations; the same block also declares split, split_retirement and split_decision, which this flow does not cover.
2. `app/controllers/api/v2/migrations/app_feature_completions_controller.rb` (`create`, `create_params`) — Permits feature_gate and version, merges current_app, and calls AppFeatureCompletionMigration#save.
3. `app/controllers/api/v2/migrations/app_remote_kills_controller.rb` (`create`, `create_params`) — Permits split, reason, override_to, first_bad_version and fixed_version, merges current_app, and calls AppRemoteKillMigration#save.
4. `app/controllers/authenticated_api_controller.rb` (`authenticate`, `current_app`) — Looks up App by the basic-auth name, compares auth_secret with secure_compare, and sets current_app; a mismatch returns 401.
5. `app/controllers/unauthenticated_api_controller.rb` (`render_errors`) — Renders the model's errors as JSON with status 422.
6. `app/models/app_feature_completion_migration.rb` (`AppFeatureCompletionMigration`, `destroy?`, `feature_gate_model`) — Decides create-or-update versus destroy, and finds the existing row by feature gate.
7. `app/models/app_remote_kill_migration.rb` (`AppRemoteKillMigration`, `destroy?`, `split_model`) — Decides create-or-update versus destroy, and finds the existing row by (split, reason).
8. `app/models/app_feature_completion.rb` (`feature_gate_must_be_a_feature_gate`) — Validates the write path for completions: uniqueness of the gate per app, and that the gate is a feature gate when one is given.
9. `app/models/app_remote_kill.rb` (`must_not_overlap_existing`, `fixed_version_must_be_greater_than_first_bad_version`) — Validates the write path for remote kills: fixed_version must be greater than first_bad_version, and the window must not overlap another kill for the same app and split.

## Invariants

- Create and update share one path: find_or_initialize_by finds the existing row, then save updates it.
- The destroy path checks only the migration's own rules (gate or split existence and, for kills, reason presence) and skips the model validations.
- A kill's identity is (app, split, reason), so a new reason creates a second kill rather than replacing one.
