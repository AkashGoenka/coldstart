---
id: app-models-bulk-reassignment-rb-81623507
type: file
character: single
title: "app/models/bulk_reassignment.rb"
anchors:
  - {"path":"app/models/bulk_reassignment.rb","symbols":["BulkReassignment","assignment_id_clause","insert_previous_assignments"],"hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.938Z
edits: 1
---

# app/models/bulk_reassignment.rb

Writes previous_assignments and updates assignments with raw SQL (no callbacks, no validations), so rules in Assignment model are bypassed here; it clears mixpanel_result and visitor_supersession_id and sets context 'bulk_assignment'. Concurrency is serialized with with_transactional_lock('bulk_reassignment') (from the with_transactional_lock gem, delegated through BulkAssignment) and it locks the selected rows; an empty assignments list becomes `IS NULL` so it is a no-op. The timestamp used is bulk_assignment.created_at.
