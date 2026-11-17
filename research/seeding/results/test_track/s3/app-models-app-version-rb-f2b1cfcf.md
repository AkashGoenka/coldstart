---
id: app-models-app-version-rb-f2b1cfcf
type: file
character: single
title: "app/models/app_version.rb"
anchors:
  - {"path":"app/models/app_version.rb","symbols":["initialize","<=>","VERSION_REGEX"],"hash":"sha256:777d872220bd","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.610Z
edits: 1
---

# app/models/app_version.rb

Versions are one to three dot-separated decimal integers, at most 18 characters, and compare component by component through to_a, so 1.10 sorts above 1.9. Invalid input raises from initialize; this is a plain Ruby value class, and the database-facing conversion lives in AppVersionType. The comment above VERSION_REGEX says any future change may only relax validation, never tighten it, because every existing version string must stay valid and keep its order.
