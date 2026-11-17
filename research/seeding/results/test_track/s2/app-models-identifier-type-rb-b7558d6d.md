---
id: app-models-identifier-type-rb-b7558d6d
type: file
character: single
title: "app/models/identifier_type.rb"
anchors:
  - {"path":"app/models/identifier_type.rb","symbols":["IdentifierType","name_must_be_snake_case","underscored?"],"hash":"sha256:8fc21d1a68db","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.964Z
edits: 1
---

# app/models/identifier_type.rb

Name uniqueness is global, not scoped to owner_app: `validates :name, uniqueness: true` has no scope and db/schema.rb puts a unique index on identifier_types.name alone, so a name claimed by one app blocks every other app even though the row belongs to owner_app. snake_case is enforced by a round-trip check (`string == string.underscore`), which is why `fooBar` is rejected (spec/models/identifier_type_spec.rb); the check is skipped for a nil name and presence is a separate validation.
