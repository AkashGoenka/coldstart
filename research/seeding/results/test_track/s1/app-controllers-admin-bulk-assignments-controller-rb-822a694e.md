---
id: app-controllers-admin-bulk-assignments-controller-rb-822a694e
type: file
character: single
title: "app/controllers/admin/bulk_assignments_controller.rb"
anchors:
  - {"path":"app/controllers/admin/bulk_assignments_controller.rb","symbols":["create","enqueue_assignments"],"hash":"sha256:50ce51ab4839","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:38.482Z
edits: 1
---

# app/controllers/admin/bulk_assignments_controller.rb

`create` only enqueues: `BulkAssignmentJob.perform_later(create_params.to_h)` runs only when the form object passes `valid?`, and the flash says 'Enqueued', so a redirect here does not mean any visitor was moved. That `valid?` is the same check the job repeats, and it only counts identifiers. `split` comes from the URL id and `admin` from current_admin, and both are merged into the params the job receives.
