---
id: app-models-visitor-rb-ad52e812
type: file
character: single
title: "app/models/visitor.rb"
anchors:
  - {"path":"app/models/visitor.rb","symbols":["from_id","assignments","assignments_for"],"hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.552Z
edits: 1
---

# app/models/visitor.rb

Visitor.from_id is find-or-create: a UUID that does not exist yet silently creates a visitor row, so any claim or lookup carrying a new visitor_id mints one; a RecordNotUnique race re-reads it. The has_many :assignments association carries for_presentation, so visitor.assignments and assignment_registry hide finished-split and decision-overridden rows. assignments_for(app_build) does its own scoping on Assignment.where(visitor:) and is not affected by the association scope. Code that needs every row of a visitor has to query Assignment.where(visitor:) directly.
