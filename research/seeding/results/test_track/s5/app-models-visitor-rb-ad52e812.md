---
id: app-models-visitor-rb-ad52e812
type: file
character: single
title: "app/models/visitor.rb"
anchors:
  - {"path":"app/models/visitor.rb","symbols":["from_id","assignments_for"],"hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.926Z
edits: 1
---

# app/models/visitor.rb

Visitor.from_id is the universal get-or-create used by every write path: any well-formed UUID becomes a visitor on first sight (primary key supplied by the client), with RecordNotUnique rescued for races. The API never authenticates visitors, so possession of a visitor id is full control of that visitor's identity.
