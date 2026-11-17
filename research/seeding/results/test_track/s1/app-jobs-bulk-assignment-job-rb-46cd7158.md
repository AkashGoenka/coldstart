---
id: app-jobs-bulk-assignment-job-rb-46cd7158
type: file
character: single
title: "app/jobs/bulk_assignment_job.rb"
anchors:
  - {"path":"app/jobs/bulk_assignment_job.rb","symbols":["perform"],"hash":"sha256:db14032212ac","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.488Z
edits: 1
---

# app/jobs/bulk_assignment_job.rb

The whole job is `BulkAssignmentCreation.new(params).save!`. Because `save!` runs `valid?` again, the 2% identifier guard can fail here after the admin was already shown 'Enqueued'; the job then raises `ActiveRecord::RecordInvalid` and nothing is written.
