---
id: server-utils-permissions-go-e0ada5dc
type: file
character: single
title: "server/utils/permissions.go"
anchors:
  - {"path":"server/utils/permissions.go","symbols":["CheckPermission","AdminOnlyMiddleware"],"hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.414Z
edits: 2
---

# server/utils/permissions.go

CheckPermission checks fns_ tokens first: only (PermissionUpload, ResourceApps) passes, with non-empty allowed_apps; everything else is 403. Admins bypass all flags; team users get a switch over resource then permission with no default case, so a new ResourceType needs a new case or team users are denied while admins still pass. channels/platforms/archs only have create/delete/edit bits, so Download/Upload on them is always denied. It does not check allow-lists: it only copies the team user's Allowed lists into the gin context (allowed_channels/platforms/archs are set here and read by no other non-test Go file), and per-resource scope is enforced by Ensure* calls elsewhere. AdminOnlyMiddleware rejects any fns_ token with 403 before checking the principal type.
