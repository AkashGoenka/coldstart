---
id: app-models-visitor-lookup-rb-839b1d02
type: file
character: single
title: "app/models/visitor_lookup.rb"
anchors:
  - {"path":"app/models/visitor_lookup.rb","symbols":["visitor","_identifier"],"hash":"sha256:2d5975587453","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.904Z
edits: 1
---

# app/models/visitor_lookup.rb

Lookup is not a merge: when the identifier is unknown, identifier finds or creates it with a brand-new Visitor (create_with visitor: Visitor.new), so the lookup writes an Identifier and a Visitor. It never creates a VisitorSupersession. visitor returns identifier.visitor, the current owner after any earlier merge.
