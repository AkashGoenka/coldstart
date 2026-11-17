---
id: app-models-bulk-reassignment-rb-81623507
type: file
character: single
title: "app/models/bulk_reassignment.rb"
anchors:
  - {"path":"app/models/bulk_reassignment.rb","symbols":["save","insert_previous_assignments","update_assignments","assignment_id_clause","assignment_ids_sql"],"hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:48.773Z
edits: 1
---

# app/models/bulk_reassignment.rb

BulkReassignment does two set-based SQL statements, an INSERT into previous_assignments and an UPDATE on assignments, not per-record saves, so callbacks and validations on Assignment do not run. A relation passed as assignments is turned into a subquery with .lock (SELECT ... FOR UPDATE). The whole save runs inside with_transactional_lock('bulk_reassignment'), a method from the with_transactional_lock gem (Gemfile:60); that gem is not vendored in this repo, so its exact semantics are not verified here.
