---
id: app-models-bulk-reassignment-rb-81623507
type: file
character: single
title: "app/models/bulk_reassignment.rb"
anchors:
  - {"path":"app/models/bulk_reassignment.rb","symbols":["BulkReassignment","save","update_assignments","insert_previous_assignments","save!"],"hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.599Z
edits: 2
---

# app/models/bulk_reassignment.rb

Snapshots each superseded assignment into previous_assignments and then rewrites it, both as raw SQL under a lock. The snapshot's bulk_assignment_id is the old row's value, while superseded_at and the rewritten bulk_assignment_id come from the new bulk. `with_transactional_lock` is delegated to BulkAssignment and is not defined anywhere in this repo's Ruby code. save! raises a plain string error, not ActiveRecord::RecordInvalid, so a caller that rescues RecordInvalid will miss it.
