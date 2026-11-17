---
id: how-a-split-is-configured-decided-and-retired-and-what-an-up
type: flow
title: "how a split is configured, decided and retired, and what an upsert resets"
anchors:
  - {"path":"app/controllers/api/v1/split_configs_controller.rb","hash":"sha256:0981a1d757a5","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/split_retirement_migration.rb","hash":"sha256:f1ab7ab023a4","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/split_configs_controller.rb","hash":"sha256:3a98b6a0fcdb","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/decisions_controller.rb","hash":"sha256:12c7670466c3","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:05.650Z
edits: 1
---

# how a split is configured, decided and retired, and what an upsert resets

Every reweight, decision and API config goes through SplitUpsert#save, which always assigns finished_at and decided_at from its own attributes (nil unless passed), so any save that omits them clears them: Decision (admin decide or v2 split_decisions) un-finishes a finished split, and an admin weight change or v1 split_configs POST un-decides a decided split. Only SplitRetirementMigration passes both. Decided splits keep stored assignments but Assignment.excluding_decision_overrides hides rows not updated after decided_at; retiring via DELETE v1 split_configs just sets finished_at.

## Steps

1. `app/controllers/api/v1/split_configs_controller.rb` (`create`, `destroy`) — app-authenticated upsert (no decided_at/finished_at passed); destroy only sets finished_at
2. `app/controllers/api/v2/migrations/splits_controller.rb` (`create`) — same upsert with require_app_name_prefix true
3. `app/models/split_upsert.rb` (`save`, `merged_registry`) — assigns finished_at/decided_at unconditionally, zeroes omitted variants, calls Split#reassign_weight to record previous_split_registries
4. `app/models/decision.rb` (`save!`) — reconfigure! with winner at 100 and decided_at only
5. `app/models/split_retirement_migration.rb` (`save`) — reconfigure! with winner 100 plus decided_at and finished_at
6. `app/models/split.rb` (`build_config`, `reconfigure!`, `active`) — builds SplitUpsert from current registry; active (finished_at null or after as_of) decides what is served
7. `app/models/assignment.rb` (`excluding_decision_overrides`) — hides pre-decision assignments

## Invariants

- to keep decided_at or finished_at through a reweight, pass them explicitly
- weights must sum to 100 and be integers or the upsert fails validation
