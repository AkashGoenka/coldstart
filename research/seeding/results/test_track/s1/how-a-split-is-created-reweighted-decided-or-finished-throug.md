---
id: how-a-split-is-created-reweighted-decided-or-finished-throug
type: flow
title: "how a split is created, reweighted, decided or finished through the API"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/previous_split_registry.rb","hash":"sha256:9cd62890cf4b","head":"435fea8235b5"}
  - {"path":"spec/models/split_upsert_spec.rb","hash":"sha256:1fa2099cfc11","head":"435fea8235b5"}
  - {"path":"spec/controllers/api/v1/split_configs_controller_spec.rb","hash":"sha256:b1de01f6d813","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:14.177Z
edits: 1
---

# how a split is created, reweighted, decided or finished through the API

Every split write, including the reweight and decision paths, goes through SplitUpsert#save, which overwrites finished_at and decided_at with its own accessors (nil unless passed), so any upsert on a retired split revives it and any upsert without decided_at undecides it. Retirement from the v1 API is not an upsert: DELETE only sets finished_at, leaving the registry, history and assignments untouched. Each registry change adds one PreviousSplitRegistry row holding the old weights.

## Steps

1. `config/routes.rb` (`split_configs`, `split`) — declares POST/DELETE /api/v1/split_configs and POST /api/v2/migrations/split
2. `app/controllers/api/v1/split_configs_controller.rb` (`create`, `destroy`) — v1 create builds SplitUpsert with no owner and no prefix rule; v1 destroy only sets finished_at on the found split
3. `app/controllers/api/v2/migrations/splits_controller.rb` (`create`) — v2 create builds SplitUpsert with require_app_name_prefix: true and accepts owner
4. `app/models/split_upsert.rb` (`save`, `zeroed_registry`, `split`) — zeroes the existing variants, merges the request, and calls reassign_weight only when the registry changed, then validates and saves
5. `app/models/split.rb` (`reassign_weight`, `name_must_only_be_prefixed_with_app_name`, `registry_weights_must_sum_to_100`) — reassign_weight builds the history row; the name and weight validations reject bad input before anything is written
6. `app/models/decision.rb` (`save!`) — a decision is reconfigure! with {variant => 100} and decided_at set, so it goes back through SplitUpsert
7. `app/models/previous_split_registry.rb` (`PreviousSplitRegistry`) — the history table row written by reassign_weight; registry and superseded_at are required

## Invariants

- Registry weights of a split are integers that sum to 100 (Split validations)
- A decided split has a variant at 100 (registry_must_have_winning_variant_if_decided)
- Split names are unique across all apps, so a retired split's name is reused only by reviving that same row (find_or_initialize_by)
- Finished splits drop out of Split.active and therefore for_presentation, but their rows remain
- A save that leaves the registry unchanged writes no PreviousSplitRegistry row
