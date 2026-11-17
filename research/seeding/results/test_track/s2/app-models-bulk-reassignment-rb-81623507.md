---
id: app-models-bulk-reassignment-rb-81623507
type: file
character: single
title: "app/models/bulk_reassignment.rb"
anchors:
  - {"path":"app/models/bulk_reassignment.rb","symbols":["BulkReassignment","insert_previous_assignments","update_assignments","assignment_id_clause"],"hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.304Z
edits: 1
---

# app/models/bulk_reassignment.rb

save runs its work under with_transactional_lock('bulk_reassignment'), a gem lock delegated to BulkAssignment, and always copies the current rows into previous_assignments before rewriting them, so that insert has to stay first. Rewritten rows take bulk_assignment.created_at as their timestamp rather than the wall clock, and they get mixpanel_result and visitor_supersession_id cleared. An empty assignments list compiles to 'IS NULL', which matches nothing, yet save still returns true. Callers create the BulkAssignment first: BulkAssignmentCreation#save (inside Assignment.transaction) and VariantRetirement#save!.
