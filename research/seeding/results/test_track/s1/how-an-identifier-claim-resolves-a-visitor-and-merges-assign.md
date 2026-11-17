---
id: how-an-identifier-claim-resolves-a-visitor-and-merges-assign
type: flow
title: "how an identifier claim resolves a visitor and merges assignments"
anchors:
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/models/app_identifier_claim.rb","hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor_supersession.rb","hash":"sha256:a51b85426367","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.530Z
edits: 1
---

# how an identifier claim resolves a visitor and merges assignments

A claim lands on the identifier's current owner, not on the visitor_id in the request: when they differ, VisitorSupersession copies the claimed visitor's assignments onto the owner, and the v4 response is built from the owner. The same supersession runs when a claim forks a new Visitor for a conflicting value, so the fork inherits the claimed visitor's assignments. The copy is additive; the claimed visitor keeps its own rows.

## Steps

1. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — entry point; reads visitor, app_build and assignments from the claim after save
2. `app/models/app_identifier_claim.rb` (`save`) — wraps IdentifierClaim with the app build path; returns the identifier owner as visitor
3. `app/models/identifier_claim.rb` (`save!`, `_non_conflicting_visitor`, `supersede_visitor!`) — finds or creates the Identifier; forks a Visitor on a same-type conflict; creates a VisitorSupersession whenever the owner differs from the claimed visitor
4. `app/models/visitor_supersession.rb` (`merge_assignments!`, `create_or_ignore_duplicate`) — after_create copy of non-feature-gate assignments the superseding visitor does not already have
5. `app/models/visitor.rb` (`from_id`, `assignments`) — from_id find-or-creates the visitor; the assignments association applies for_presentation to both sides of the merge
6. `app/models/assignment.rb` (`for_presentation`, `except_feature_gates`) — scopes that decide which rows count as present on the target and which rows are copied

## Invariants

- A VisitorSupersession exists whenever the resolved identifier owner differs from the claimed visitor, including the fork case.
- Copies skip feature-gate assignments and never replace a split the target already has.
- Both sides of the merge are read through for_presentation, so a row hidden by that scope on the target does not block a copy; the resulting unique violation on (split_id, visitor_id) is rescued per row in a savepoint.
- Copied rows carry context 'visitor_supersession' and mixpanel_result nil, so they count as unsynced.
