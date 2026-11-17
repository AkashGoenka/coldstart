---
id: app-models-visitor-rb-ad52e812
type: file
character: single
title: "app/models/visitor.rb"
anchors:
  - {"path":"app/models/visitor.rb","symbols":["from_id","assignments_for","assignment_registry"],"hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.353Z
edits: 1
---

# app/models/visitor.rb

Visitor.from_id is find_or_create_by! with a rescue for RecordNotUnique that falls back to find, so two first requests for the same id both succeed. That rescue does not cover the UUID format validation: a malformed id makes create! raise ActiveRecord::RecordInvalid, which propagates to the caller. assignments_for(app_build) applies the build-specific filtering, while assignment_registry uses the no-build association scope, and assignment_registry has no callers under app/ or lib/.
