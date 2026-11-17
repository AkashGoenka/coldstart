---
id: src-middleware-memberhasrolepermission-ts-f7a60ce6
type: file
character: single
title: "src/middleware/memberHasRolePermission.ts"
anchors:
  - {"path":"src/middleware/memberHasRolePermission.ts","symbols":["memberHasRolePermissionMiddleware","memberHasRolePermission"],"hash":"sha256:64d9209e9c76","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.860Z
edits: 2
---

# src/middleware/memberHasRolePermission.ts

Passes without reading any bit when req.serverCache is unset (DM/ticket, or when serverMemberVerification did not run before it), when the member is serverCache.createdById, or when it has the role ADMIN bit (ignoreAdmin exists; no caller passes it). Otherwise 403 'Missing <permission> permission'; only channelMessagePinAdd, channelMessagePinRemove and channelMessageDelete pass continueOnError to store req.errorMessage and continue. The tuple form memberHasRolePermission(req, bit) is also used by channelMessageCreate to compute MENTION_EVERYONE / MENTION_ROLES rights, not to gate.
