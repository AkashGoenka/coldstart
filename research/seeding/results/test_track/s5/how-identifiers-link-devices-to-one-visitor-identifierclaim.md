---
id: how-identifiers-link-devices-to-one-visitor-identifierclaim
type: flow
title: "how identifiers link devices to one visitor (IdentifierClaim and VisitorSupersession)"
anchors:
  - {"path":"app/controllers/api/v1/identifiers_controller.rb","hash":"sha256:e7c50dd4fc7a","head":"435fea8235b5"}
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor_supersession.rb","hash":"sha256:a51b85426367","head":"435fea8235b5"}
  - {"path":"app/models/app_identifier_claim.rb","hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
  - {"path":"app/models/visitor_lookup.rb","hash":"sha256:2d5975587453","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.856Z
edits: 1
---

# how identifiers link devices to one visitor (IdentifierClaim and VisitorSupersession)

Identity merging happens as a side effect of POST /api/v1/identifier: IdentifierClaim finds-or-creates the Identifier (unique on type+value); if the identifier already belongs to a different visitor than the caller's, a VisitorSupersession is created and its after_create copies the old visitor's assignments to the surviving one for splits the survivor lacks (context 'visitor_supersession', feature gates excluded, duplicates silently ignored). The caller's visitor_id is then abandoned, and the response returns the identifier's visitor, so clients must adopt the returned visitor id. If the visitor already has a DIFFERENT value for the same identifier type, a brand new Visitor is created for the identifier instead of reassigning it.

## Steps

1. `app/controllers/api/v1/identifiers_controller.rb` (`create`) — unauthenticated, CORS-enabled
2. `app/models/identifier_claim.rb` (`IdentifierClaim`, `non_conflicting_visitor`, `supersede_visitor!`) — claim logic, race handling via RecordNotUnique
3. `app/models/visitor_supersession.rb` (`merge_assignments!`) — assignment carry-over
4. `app/models/app_identifier_claim.rb` (`AppIdentifierClaim`) — v4 combo of build path validation + claim; returns config in one call
5. `app/models/visitor_lookup.rb` (`VisitorLookup`) — read path that CREATES a visitor+identifier if none exists (find_or_create_by!)

## Invariants

- IdentifierType must exist first (created via authenticated POST /api/v1/identifier_type); claims with unknown type fail validation
- Visitor.from_id creates visitors on demand from any UUID-format id
