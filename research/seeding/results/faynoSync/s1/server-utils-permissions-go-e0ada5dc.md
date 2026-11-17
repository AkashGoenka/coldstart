---
id: server-utils-permissions-go-e0ada5dc
type: file
character: single
title: "server/utils/permissions.go"
anchors:
  - {"path":"server/utils/permissions.go","symbols":["CheckPermission","AdminOnlyMiddleware"],"hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.126Z
edits: 4
---

# server/utils/permissions.go

CheckPermission is a route gate, not the whole access check: for a team user it tests only the boolean flag for the (resource, permission) pair and copies the non-empty allowed lists into gin context keys (allowed_apps, allowed_channels, allowed_platforms, allowed_archs); the lists themselves are enforced in handlers. Admins pass with no lookup. The switch has no download or upload case for channels, platforms or archs, so a team user checked for those gets 403 Permission denied. An fns_ API token passes only for PermissionUpload on ResourceApps with a non-empty allowed_apps; that branch runs before the principal check.
