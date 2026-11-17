---
id: app-models-visitor-lookup-rb-839b1d02
type: file
character: single
title: "app/models/visitor_lookup.rb"
anchors:
  - {"path":"app/models/visitor_lookup.rb","symbols":["VisitorLookup","_identifier","visitor"],"hash":"sha256:2d5975587453","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.312Z
edits: 1
---

# app/models/visitor_lookup.rb

Resolving a visitor is a write: _identifier does find_or_create_by! with create_with(visitor: Visitor.new), so the GET in Api::V1::IdentifierVisitorsController#show creates an Identifier and a Visitor for any unseen type and value. A unique-index race is handled by rescuing ActiveRecord::RecordNotUnique and re-finding. The identifier type is looked up with find_by!, so an unknown identifier_type_name raises before anything is created. visitor is memoized per lookup object.
