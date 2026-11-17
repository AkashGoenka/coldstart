---
id: how-a-second-visitor-claiming-an-identifier-merges-into-the
type: flow
title: "how a second visitor claiming an identifier merges into the existing visitor"
anchors:
  - {"path":"app/controllers/api/v1/identifiers_controller.rb","hash":"sha256:e7c50dd4fc7a","head":"435fea8235b5"}
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/models/app_identifier_claim.rb","hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
  - {"path":"app/models/visitor_supersession.rb","hash":"sha256:a51b85426367","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.882Z
edits: 1
---

# how a second visitor claiming an identifier merges into the existing visitor

Claiming a value that another visitor already owns re-points no rows: the existing Identifier keeps its owner, the claimant's other identifiers stay put, and only assignments are copied, via a VisitorSupersession row whose after_create does the copy. The same supersession fires when a claimant adds a second value of an identifier type it already holds, because _non_conflicting_visitor creates a fresh Visitor and the claimant's assignments are copied into that new visitor. The device path (AppIdentifierClaim) returns the owner as the visitor, not the visitor_id that was sent.

## Steps

1. `app/controllers/api/v1/identifiers_controller.rb` (`create`) — entry point: builds an IdentifierClaim from params, calls save!, and renders claim.errors only when save! returns false
2. `app/models/identifier_claim.rb` (`save!`, `find_or_create_identifier`, `supersede_visitor!`) — find-or-create the Identifier, then create a VisitorSupersession when identifier.visitor differs from the claimed visitor
3. `app/models/visitor.rb` (`from_id`) — resolves the claimed visitor_id with find_or_create_by!, so an unknown id creates the visitor row before any merge
4. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — device path: calls AppIdentifierClaim#save and then reads visitor and assignments from the claim, so it serves the owner's assignments
5. `app/models/app_identifier_claim.rb` (`save`, `visitor`) — wraps IdentifierClaim; visitor is set to identifier_claim.identifier.visitor after a successful save
6. `app/models/visitor_supersession.rb` (`merge_assignments!`, `create_or_ignore_duplicate`) — after_create copies the superseded visitor's assignments onto the superseding visitor, skipping splits the target already has

## Invariants

- Identifier.visitor is the only ownership pointer; nothing in these files updates an Identifier row during a merge.
- A supersession is written only when identifier.visitor differs from the claimed visitor, checked after find-or-create, so a fresh claim of an unowned value writes none.
- Feature-gate assignments are never copied (the except_feature_gates scope).
