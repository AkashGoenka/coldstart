---
id: app-controllers-admin-split-assignments-controller-rb-226676e7
type: file
character: single
title: "app/controllers/admin/split_assignments_controller.rb"
anchors:
  - {"path":"app/controllers/admin/split_assignments_controller.rb","symbols":["index","VIEW_LIMIT"],"hash":"sha256:b83d64361cc6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.865Z
edits: 1
---

# app/controllers/admin/split_assignments_controller.rb

`index` caps the list at `VIEW_LIMIT` (1000) by limiting the assignments relation, and the warning compares `split.assignments.count` against the same limit. The relation has no `order`, so this file does not decide which 1000 are shown. An unknown split id raises from `Split.find`. Access is `AuthenticatedAdminController`'s Devise `authenticate_admin!`, not the app API key used by the migrations endpoints.
