---
id: app-models-identifier-rb-5a187b24
type: file
character: single
title: "app/models/identifier.rb"
anchors:
  - {"path":"app/models/identifier.rb","symbols":["Identifier"],"hash":"sha256:30ff4160c0be","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:55.170Z
edits: 1
---

# app/models/identifier.rb

The model validates only that value is present and that both belongs_to exist; it has no uniqueness validation. Uniqueness of (value, identifier_type_id) is enforced only by the unique index in db/schema.rb, so a duplicate shows up as ActiveRecord::RecordNotUnique at insert, not as a validation error. IdentifierClaim#create_identifier rescues that error and re-finds the existing row, so code that creates identifiers through the claim never sees the conflict.
