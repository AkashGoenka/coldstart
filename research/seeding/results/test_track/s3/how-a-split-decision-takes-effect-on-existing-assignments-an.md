---
id: how-a-split-decision-takes-effect-on-existing-assignments-an
type: flow
title: "how a split decision takes effect on existing assignments and client registries"
anchors:
  - {"path":"app/controllers/api/v2/migrations/split_decisions_controller.rb","hash":"sha256:40a692d7b2a7","head":"435fea8235b5"}
  - {"path":"app/models/split_decision_migration.rb","hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.775Z
edits: 1
---

# how a split decision takes effect on existing assignments and client registries

A decision never rewrites assignment rows: existing assignments are hidden from presentation by a timestamp comparison (assignment updated_at must be later than split decided_at), not migrated. The decision sets the registry to 100 for the chosen variant and 0 for the rest, stamps decided_at, and keeps the old registry in previous_split_registries. The registry endpoints set no cache headers, so the next fetch returns the winner.

## Steps

1. `app/controllers/api/v2/migrations/split_decisions_controller.rb` (`create`) — POST handler: builds SplitDecisionMigration for current_app, returns 204 on success or 422 with errors.
2. `app/models/split_decision_migration.rb` (`save`, `split_model`) — Looks the split up by owner_app and name, checks the variant is in its registry, then calls create_decision!.
3. `app/models/decision.rb` (`save!`) — Calls split.reconfigure! with weighting_registry {variant => 100} and decided_at = now.
4. `app/models/split.rb` (`reconfigure!`, `reassign_weight`) — reconfigure! goes through SplitUpsert; reassign_weight snapshots the old registry into previous_split_registries before replacing it.
5. `app/models/split_upsert.rb` (`save`) — Merges the given weights over zeroed existing variants, assigns decided_at, calls reassign_weight, then saves.
6. `app/models/assignment.rb` (`excluding_decision_overrides`, `for_presentation`) — Read side: rows with updated_at at or before decided_at drop out of Split#assignments and Assignment.for_presentation.
7. `app/views/api/v4/split_registries/show.json.jbuilder` (`registry`) — Client-facing registry: renders split.registry per active split, so the winner shows as weight 100. decided_at is not in the response.

## Invariants

- Existing assignment rows keep their old variant; only the timestamp comparison hides them.
- Split.active ignores decided_at: a decided split stays in the registry until finished_at is set.
- The pre-decision weights survive only in previous_split_registries; the splits row holds the current registry only.
