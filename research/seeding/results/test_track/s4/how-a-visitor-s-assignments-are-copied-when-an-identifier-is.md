---
id: how-a-visitor-s-assignments-are-copied-when-an-identifier-is
type: flow
title: "how a visitor's assignments are copied when an identifier is claimed"
anchors:
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor_supersession.rb","hash":"sha256:a51b85426367","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:53.012Z
edits: 1
---

# how a visitor's assignments are copied when an identifier is claimed

Claiming an identifier that belongs to another visitor copies the superseded visitor's assignments onto the superseding visitor, but only non-feature-gate splits the target does not already have. Feature-gate rows never move, so a visitor cannot gain a closed gate by being merged into a privileged identity. The copy is a create, never an update, so the target's own rows are not overwritten.

## Steps

1. `app/models/identifier_claim.rb` (`supersede_visitor!`) — claiming an identifier owned by another visitor creates a VisitorSupersession with the identifier's visitor as the superseding side
2. `app/models/visitor_supersession.rb` (`merge_assignments!`, `create_or_ignore_duplicate`) — after_create copies assignments; the target's split ids are checked first, then each copy runs in a savepoint and a unique violation is swallowed
3. `app/models/assignment.rb` (`except_feature_gates`) — removes feature-gate rows from the copy set
4. `app/models/split.rb` (`except_feature_gates`) — the gate test itself: feature_gate = false, reached through the assignment scope's join
5. `app/models/visitor.rb` (`assignments`) — both the source and the target id set are Visitor#assignments, i.e. for_presentation rows only, so decision-overridden and finished-split rows are neither copied nor counted as present

## Invariants

- A visitor never gets two assignments for one split: the (split_id, visitor_id) unique index is the real guard and the rescue in create_or_ignore_duplicate relies on it.
- A target row hidden by for_presentation (decision override or finished split) is not in the id set, so the copy is attempted and then dropped by that unique index, which keeps the target's row.
- Copied rows get context 'visitor_supersession' and visitor_supersession_id set, and no mixpanel_result.
