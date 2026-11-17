---
id: app-models-app-remote-kill-migration-rb-f78f20fc
type: file
character: single
title: "app/models/app_remote_kill_migration.rb"
anchors:
  - {"path":"app/models/app_remote_kill_migration.rb","symbols":["AppRemoteKillMigration","destroy?","split_model"],"hash":"sha256:5cb3a8785f67","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.749Z
edits: 1
---

# app/models/app_remote_kill_migration.rb

A blank first_bad_version (nil or empty string, checked before type cast) makes the request a delete: it destroys the AppRemoteKill matching split and reason, and only that path runs the split-exists check. Otherwise it saves that same record, so a repeat request with the same split and reason updates it in place. The split is looked up with Split.find_by(name:) with no owner_app scope, unlike SplitDecisionMigration; the kill is still keyed to the caller's app, so it only affects that app's builds.
