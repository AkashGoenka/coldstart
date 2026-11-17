---
id: how-to-add-a-new-api-endpoint-or-form-object-write-path
type: flow
title: "how to add a new API endpoint or form-object write path"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/app_remote_kills_controller.rb","hash":"sha256:67bc2acd143b","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill_migration.rb","hash":"sha256:5cb3a8785f67","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion_migration.rb","hash":"sha256:f9a8a9ed3c53","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.881Z
edits: 1
---

# how to add a new API endpoint or form-object write path

Convention here: controllers stay thin and delegate to a PORO in app/models that includes ActiveModel::Model/Validations and exposes save/save!/create! (SplitUpsert, IdentifierClaim, *Migration classes); controllers call `render_errors obj` (422 + {errors}) on failure. To add an endpoint: pick the base controller by auth need, add the route in config/routes.rb inside the right api/vN namespace (OPTIONS match route + CorsSupport only if browsers call it), add a jbuilder view named after the action if it renders data, and permit params explicitly with params.permit. For hash params whose keys are arbitrary use `weighting_registry: params[:weighting_registry].try(:keys)` as in SplitConfigsController.

## Steps

1. `config/routes.rb` (`namespace`) — route declaration
2. `app/controllers/api/v2/migrations/app_remote_kills_controller.rb` (`create`) — example thin controller over a migration PORO
3. `app/models/app_remote_kill_migration.rb` (`AppRemoteKillMigration`) — PORO wrapper: blank first_bad_version means DESTROY the record (idempotent upsert/delete by presence)

## Invariants

- Migration POROs: blank version means delete (AppFeatureCompletionMigration too)
- Migration endpoints are keyed to current_app
