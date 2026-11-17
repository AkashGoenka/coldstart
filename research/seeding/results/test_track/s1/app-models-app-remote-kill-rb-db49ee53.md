---
id: app-models-app-remote-kill-rb-db49ee53
type: file
character: single
title: "app/models/app_remote_kill.rb"
anchors:
  - {"path":"app/models/app_remote_kill.rb","symbols":["affecting","overlapping"],"hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.014Z
edits: 1
---

# app/models/app_remote_kill.rb

affecting matches a build when first_bad_version <= build version and fixed_version is null or strictly greater than it, so the fixed version itself is not affected. The kill is scoped to one app and one split, and its override_to is what Split.with_remote_kill_knockouts_for hands to the registry. Overlap is blocked only by the must_not_overlap_existing validation; the database does not enforce it, and the scalar subquery in Split would fail if two kills matched the same build.
