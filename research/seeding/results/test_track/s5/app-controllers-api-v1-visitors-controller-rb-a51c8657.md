---
id: app-controllers-api-v1-visitors-controller-rb-a51c8657
type: file
character: single
title: "app/controllers/api/v1/visitors_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/visitors_controller.rb","symbols":["show"],"hash":"sha256:0e3c9f9ae3bb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.943Z
edits: 1
---

# app/controllers/api/v1/visitors_controller.rb

GET visitors/:id never 404s and never persists: for an unknown id it builds an unsaved Visitor with that id and the view renders an empty assignments list, so clients can call it before they have any assignments.
