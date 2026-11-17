---
id: app-models-visitor-lookup-rb-839b1d02
type: file
character: single
title: "app/models/visitor_lookup.rb"
anchors:
  - {"path":"app/models/visitor_lookup.rb","symbols":["_identifier","identifier_type"],"hash":"sha256:2d5975587453","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:22.557Z
edits: 1
---

# app/models/visitor_lookup.rb

A read path that writes: on a miss, identifier lookup creates the Identifier with a brand-new Visitor (create_with(visitor: Visitor.new)), so a lookup can create rows. It never runs the fork check or VisitorSupersession, so it cannot merge two visitors. Unlike IdentifierClaim, an unknown identifier_type_name raises ActiveRecord::RecordNotFound (find_by!) rather than producing a validation error. The RecordNotUnique rescue re-reads the identifier by type and value.
