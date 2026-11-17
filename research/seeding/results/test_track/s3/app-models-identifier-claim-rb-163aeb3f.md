---
id: app-models-identifier-claim-rb-163aeb3f
type: file
character: single
title: "app/models/identifier_claim.rb"
anchors:
  - {"path":"app/models/identifier_claim.rb","symbols":["save!","_non_conflicting_visitor","create_identifier"],"hash":"sha256:c7060c5f6b53","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.893Z
edits: 1
---

# app/models/identifier_claim.rb

save! returns false on invalid input, but the class-level create! always returns the object, so only the instance save! result signals failure. When the claimed visitor already holds a different value of the same identifier type, _non_conflicting_visitor creates a fresh Visitor and the new Identifier goes to it, so the claimant's assignments are copied to that new visitor, not to the existing owner. create_identifier rescues RecordNotUnique and falls back to the row a racing claim wrote, which means a race also produces a supersession.
