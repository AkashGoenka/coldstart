---
id: how-claiming-an-identifier-merges-visitors-and-carries-assig
type: flow
title: "how claiming an identifier merges visitors and carries assignments over"
anchors:
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/models/app_identifier_claim.rb","hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor_supersession.rb","hash":"sha256:a51b85426367","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:05.646Z
edits: 1
---

# how claiming an identifier merges visitors and carries assignments over

In IdentifierClaim the visitor the client sent is the superseded one and the visitor already owning the identifier is the superseding one, and the API returns the identifier's visitor, so the client adopts the existing id while the old visitor's assignments are copied to it. The copy reads superseded_visitor.assignments, which is the for_presentation scope, so assignments on finished splits or hidden by a decision are not carried; feature-gate splits are excluded, force is not copied, and each copy gets context visitor_supersession.

## Steps

1. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — builds the response config for identifier_claim's identifier.visitor, not the visitor_id sent
2. `app/models/app_identifier_claim.rb` (`save`) — validates build path and claim, then exposes identifier.visitor
3. `app/models/identifier_claim.rb` (`save!`, `create_identifier`, `non_conflicting_visitor`, `supersede_visitor!`) — find or create the identifier; a new identifier gets a fresh Visitor if the sender already has another of that type; supersede only when identifier.visitor differs
4. `app/models/visitor_supersession.rb` (`merge_assignments!`, `create_or_ignore_duplicate`) — after_create copy of assignments, skipping splits the target already has
5. `app/models/visitor.rb` (`assignments`, `from_id`) — has_many :assignments carries the for_presentation scope; from_id creates the sender visitor if unseen

## Invariants

- splits the target visitor already has always win; conflicts are swallowed
- Identifier uniqueness exists only as a DB index, so IdentifierClaim relies on rescuing RecordNotUnique
