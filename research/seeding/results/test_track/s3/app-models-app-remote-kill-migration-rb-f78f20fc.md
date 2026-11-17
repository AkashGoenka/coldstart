---
id: app-models-app-remote-kill-migration-rb-f78f20fc
type: file
character: single
title: "app/models/app_remote_kill_migration.rb"
anchors:
  - {"path":"app/models/app_remote_kill_migration.rb","symbols":["destroy?","split_model","app_remote_kill"],"hash":"sha256:5cb3a8785f67","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.665Z
edits: 1
---

# app/models/app_remote_kill_migration.rb

A blank first_bad_version means delete, matched on (app, split, reason), so a caller must resend the same reason to remove a kill. split_must_exist and the reason presence check run only on the destroy path; writes are validated by AppRemoteKill, including its snake_case reason format. fixed_version is not part of the lookup key, so a POST with the same reason and a new fixed_version edits the existing kill.
