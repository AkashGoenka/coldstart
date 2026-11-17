---
id: app-models-app-remote-kill-rb-db49ee53
type: file
character: single
title: "app/models/app_remote_kill.rb"
anchors:
  - {"path":"app/models/app_remote_kill.rb","symbols":["affecting","overlapping","must_not_overlap_existing","fixed_version_must_be_greater_than_first_bad_version"],"hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.654Z
edits: 1
---

# app/models/app_remote_kill.rb

A kill's window is first_bad_version <= build version < fixed_version, where a NULL fixed_version is open-ended; affecting(app_build) encodes this in SQL over the integer-array columns. Uniqueness is on (app, split, reason), with the reason required to be lowercase snake_case. must_not_overlap_existing rejects a kill whose window overlaps another kill for the same app and split, and the overlap query excludes the record itself, so re-saving the same kill is not an overlap.
