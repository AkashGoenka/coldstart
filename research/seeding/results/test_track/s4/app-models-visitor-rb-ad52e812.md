---
id: app-models-visitor-rb-ad52e812
type: file
character: hub
title: "app/models/visitor.rb"
anchors:
  - {"path":"app/models/visitor.rb","symbols":["from_id"],"hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.467Z
edits: 1
---

# app/models/visitor.rb

## Facets

- **from_id** — Uses find_or_create_by! on the id, so an unknown well-formed UUID creates the visitor row on first use; the batch override and identifier claim both reach it this way. A RecordNotUnique race re-reads with find, and a malformed id raises RecordInvalid because the UUID format is only checked by the model validation.
