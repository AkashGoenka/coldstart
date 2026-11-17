---
id: src-services-user-usermanagement-ts-882cd6bc
type: file
character: hub
title: "src/services/User/UserManagement.ts"
anchors:
  - {"path":"src/services/User/UserManagement.ts","symbols":["deleteAccount","deleteOrLeaveAllServers"],"hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.659Z
edits: 1
---

# src/services/User/UserManagement.ts

## Facets

- **deleteAccount** — For a non-bot it refuses with an error while the user still has servers or applications. When deleteContent is set it upserts schedule_account_content_delete for the user, which is the only trigger the content purge reads. The user row is kept: its username is replaced with Deleted User or Deleted Bot plus a tag, and avatar, banner, badges and custom status are cleared. When the user has no account and no application it returns success without doing anything.
- **deleteOrLeaveAllServers** — Deletes the servers the user created (deleteServer) and leaves the others (leaveServer), with a 500 ms pause between servers. Its result is not used by the account-deletion timer.
