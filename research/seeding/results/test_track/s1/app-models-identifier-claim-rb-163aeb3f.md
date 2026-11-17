---
id: app-models-identifier-claim-rb-163aeb3f
type: file
character: single
title: "app/models/identifier_claim.rb"
anchors:
  - {"path":"app/models/identifier_claim.rb","symbols":["save!","_non_conflicting_visitor","create_identifier","supersede_visitor!"],"hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.542Z
edits: 1
---

# app/models/identifier_claim.rb

save! returns false for an invalid claim instead of raising, and IdentifierClaim.create! returns the claim whether or not it is valid, so callers must check the result or valid?. A new identifier attaches to the claimed visitor only when that visitor has no other identifier of the same type with a different value (_non_conflicting_visitor); otherwise a fresh Visitor is created and the identifier attaches to it. supersede_visitor! runs whenever the identifier owner differs from the claimed visitor, which includes the fork, so a fork also gets a VisitorSupersession from the claimed visitor. If the Identifier insert loses a race (unique on value and identifier_type_id), create_identifier re-reads the winner, and a fork Visitor created just before stays behind with no identifiers.
