---
id: app-models-app-remote-kill-rb-db49ee53
type: file
character: single
title: "app/models/app_remote_kill.rb"
anchors:
  - {"path":"app/models/app_remote_kill.rb","symbols":["affecting","overlapping","must_not_overlap_existing"],"hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.918Z
edits: 1
---

# app/models/app_remote_kill.rb

A remote kill forces a split to `override_to` for builds with first_bad_version <= version and (fixed_version nil or > version). must_not_overlap_existing rejects overlapping ranges for the same app+split (error lists the conflicting reasons) and `reason` must be unique snake_case per app+split, which is the key the migration API upserts on.
