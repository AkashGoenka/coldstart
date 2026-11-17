---
id: how-a-split-is-created-or-reweighted-splitupsert-registry-hi
type: flow
title: "how a split is created or reweighted (SplitUpsert, registry history, decisions, retirement)"
anchors:
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/split_retirement_migration.rb","hash":"sha256:f1ab7ab023a4","head":"435fea8235b5"}
  - {"path":"app/models/split_decision_migration.rb","hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/split_configs_controller.rb","hash":"sha256:3a98b6a0fcdb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.861Z
edits: 1
---

# how a split is created or reweighted (SplitUpsert, registry history, decisions, retirement)

All split writes go through SplitUpsert, whether from the client gem (POST /api/v1/split_configs), the v2 migrations API, or the admin weights form (Split#build_config/reconfigure!). Upsert zero-fills every existing variant not mentioned in the incoming registry (so omitting a variant retires it to 0% rather than erroring), and a weight change appends a PreviousSplitRegistry row via Split#reassign_weight. Names ending in '_enabled' are flagged feature_gate at creation only. Deciding (Decision / SplitDecisionMigration) sets the registry to {winner=>100} and decided_at; retiring (SplitRetirementMigration) does the same plus finished_at. v2 migrations pass require_app_name_prefix: true, v1 does not.

## Steps

1. `app/controllers/api/v1/split_configs_controller.rb` (`create`, `destroy`) — legacy upsert; destroy only sets finished_at (soft delete)
2. `app/controllers/api/v2/migrations/splits_controller.rb` (`create`) — migration-style upsert with name prefix rule
3. `app/models/split_upsert.rb` (`SplitUpsert`, `merged_registry`, `feature_gate?`) — find_or_initialize by name scoped to app.splits
4. `app/models/split.rb` (`reassign_weight`, `reconfigure!`, `registry_weights_must_sum_to_100`) — validations (snake_case, weights are integers summing to 100) and history
5. `app/models/decision.rb` (`Decision`) — decide via reconfigure!

## Invariants

- Split names are globally unique; a prefix before '.' must equal the owning app name
- Weights must be integers summing to exactly 100
- Admin UI (Admin::SplitConfigsController) edits only weights of existing variants
