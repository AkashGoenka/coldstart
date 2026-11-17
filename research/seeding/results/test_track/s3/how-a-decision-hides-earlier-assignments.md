---
id: how-a-decision-hides-earlier-assignments
type: flow
title: "how a decision hides earlier assignments"
anchors:
  - {"path":"app/controllers/admin/decisions_controller.rb","hash":"sha256:12c7670466c3","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/split_decisions_controller.rb","hash":"sha256:40a692d7b2a7","head":"435fea8235b5"}
  - {"path":"app/models/split_decision_migration.rb","hash":"sha256:dfcc0b079c87","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/decision.rb","hash":"sha256:4ef6391344c1","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.105Z
edits: 1
---

# how a decision hides earlier assignments

A decision is a reconfigure to 100 for one variant plus decided_at, and it never deletes or edits assignment rows: Assignment.for_presentation drops every row whose split is decided and whose updated_at is at or before decided_at. A visitor whose only row predates the decision therefore comes back with no assignment, and DeterministicAssignmentCreation creates no new row for them because its existence check is unscoped and finds the old one.

## Steps

1. `app/controllers/admin/decisions_controller.rb` (`create`) — admin decide path: loads the split by id and calls create_decision!
2. `app/controllers/api/v2/migrations/split_decisions_controller.rb` (`create`) — migration API path; delegates to SplitDecisionMigration
3. `app/models/split_decision_migration.rb` (`save`, `split_must_exist`) — checks the split belongs to the app and the variant exists, then calls create_decision!
4. `app/models/split.rb` (`create_decision!`, `reconfigure!`) — build_decision then save; reconfigure! goes through SplitUpsert
5. `app/models/decision.rb` (`save!`) — raises unless the variant is in the split, then reconfigures to {variant => 100} with decided_at now
6. `app/models/split_upsert.rb` (`save`) — persists decided_at and clears finished_at because the decision passes neither key
7. `app/models/assignment.rb` (`for_presentation`, `excluding_decision_overrides`) — query-time filter: hides rows with updated_at at or before decided_at on decided splits
8. `app/models/visitor.rb` (`assignments_for`) — serves a visitor's presentation assignments through for_presentation

## Invariants

- Decisions do not change assignment rows; hiding happens only at read time.
- Overrides written after decided_at (updated_at greater than decided_at) stay visible.
- Deciding a finished split also clears its finished_at, because the decision passes no finished_at.
