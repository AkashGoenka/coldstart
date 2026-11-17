---
id: app-controllers-api-system-statuses-controller-rb-8a6bd8d1
type: file
character: single
title: "app/controllers/api/system/statuses_controller.rb"
anchors:
  - {"path":"app/controllers/api/system/statuses_controller.rb","symbols":["StatusesController"],"hash":"sha256:b4e733043385","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.948Z
edits: 1
---

# app/controllers/api/system/statuses_controller.rb

Health check at /api/system/status: runs `select 1` and returns 200 or 503 JSON; unauthenticated and the only checked dependency is the database.
