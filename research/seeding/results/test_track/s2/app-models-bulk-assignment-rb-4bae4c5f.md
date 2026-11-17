---
id: app-models-bulk-assignment-rb-4bae4c5f
type: file
character: single
title: "app/models/bulk_assignment.rb"
anchors:
  - {"path":"app/models/bulk_assignment.rb","symbols":["BulkAssignment"],"hash":"sha256:eb9e01a3c749","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:55.165Z
edits: 1
---

# app/models/bulk_assignment.rb

Destroying a BulkAssignment does not delete what it created: both `has_many :assignments` and `has_many :previous_assignments` are `dependent: :nullify`, so the child rows keep existing with bulk_assignment_id cleared and become ordinary assignments. The file has no validations or callbacks of its own.
