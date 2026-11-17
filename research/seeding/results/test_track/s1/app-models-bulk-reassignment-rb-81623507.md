---
id: app-models-bulk-reassignment-rb-81623507
type: file
character: single
title: "app/models/bulk_reassignment.rb"
anchors:
  - {"path":"app/models/bulk_reassignment.rb","symbols":["BulkReassignment","update_assignments","insert_previous_assignments","save"],"hash":"sha256:85602c0845e2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.500Z
edits: 2
---

# app/models/bulk_reassignment.rb

Rewrites existing assignment rows with raw SQL, so no ActiveRecord callbacks or validations run. Before the UPDATE it copies each row into previous_assignments with superseded_at and updated_at set to bulk_assignment.created_at. It then writes force from bulk_assignment.force, which is false for variant retirements, so retirement clears force on overridden rows, and it resets mixpanel_result and visitor_supersession_id. Passing a relation selects ids with FOR UPDATE as a subquery; an array becomes an IN list, and an empty array becomes `IS NULL`, which matches nothing. The save is wrapped in with_transactional_lock('bulk_reassignment'), a method from the with_transactional_lock gem; it is not defined under app/.
