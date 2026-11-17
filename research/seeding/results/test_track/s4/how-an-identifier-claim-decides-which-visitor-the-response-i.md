---
id: how-an-identifier-claim-decides-which-visitor-the-response-i
type: flow
title: "how an identifier claim decides which visitor the response is built for"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/models/app_identifier_claim.rb","hash":"sha256:b2ed95375b4a","head":"435fea8235b5"}
  - {"path":"app/models/app_version_build_path.rb","hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
  - {"path":"app/models/identifier_claim.rb","hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.414Z
edits: 1
---

# how an identifier claim decides which visitor the response is built for

The visitor the v4 identifier response is built for is the identifier's owner, not the posted visitor_id: a value already owned by another visitor makes the claimant superseded, and a conflicting value of the same identifier type gives the claimant a new visitor instead. Nothing here runs in a transaction, and the app is only resolved after the identifier has been written.

## Steps

1. `config/routes.rb` (`identifier`) — v4 route under apps/:name/versions/:number/builds/:timestamp; those path segments are never read and no OPTIONS preflight is declared for it
2. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`, `create_params`) — permits body or query keys only and renders the response from the claim's visitor
3. `app/models/app_identifier_claim.rb` (`save`) — validates the build path and the claim, writes the claim, then resolves app_build
4. `app/models/app_version_build_path.rb` (`app_build`) — App.find_by! by name, so an unknown app fails here after the identifier is already written
5. `app/models/identifier_claim.rb` (`save!`, `non_conflicting_visitor`, `supersede_visitor!`) — finds or creates the Identifier, attaches it to a fresh visitor on conflict, and records a VisitorSupersession when the owner differs from the claimant
6. `app/models/visitor.rb` (`from_id`) — find-or-creates the claimant visitor row

## Invariants

- No transaction wraps the claim and the app lookup, so an unknown app_name leaves the identifier and any supersession persisted while the request raises RecordNotFound.
- The returned visitor can differ from the posted visitor_id; a caller that assumes they match gets the wrong id.
