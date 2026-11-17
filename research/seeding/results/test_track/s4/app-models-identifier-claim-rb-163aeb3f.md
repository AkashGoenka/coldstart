---
id: app-models-identifier-claim-rb-163aeb3f
type: file
character: single
title: "app/models/identifier_claim.rb"
anchors:
  - {"path":"app/models/identifier_claim.rb","symbols":["save!","non_conflicting_visitor","supersede_visitor!"],"hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.457Z
edits: 1
---

# app/models/identifier_claim.rb

The identifier type is resolved by name through IdentifierType.find_by, and an unknown name fails validation with an error on identifier_type ('does not exist') instead of creating a type. save! returns false only on validation failure; an existing (type, value) pair is reused, and a RecordNotUnique race is resolved by re-finding it. If the claimant already holds a different value of the same type, non_conflicting_visitor creates a new Visitor and attaches the identifier to it, and whenever the owner differs from the claimant a VisitorSupersession is recorded with the claimant as the superseded side.
