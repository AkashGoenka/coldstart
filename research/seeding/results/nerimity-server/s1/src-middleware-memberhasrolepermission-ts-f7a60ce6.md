---
id: src-middleware-memberhasrolepermission-ts-f7a60ce6
type: file
character: single
title: "src/middleware/memberHasRolePermission.ts"
anchors:
  - {"path":"src/middleware/memberHasRolePermission.ts","symbols":["memberHasRolePermission","memberHasRolePermissionMiddleware"],"hash":"sha256:64d9209e9c76","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.327Z
edits: 1
---

# src/middleware/memberHasRolePermission.ts

The server-role gate, reading req.serverMemberCache.permissions rather than channel rows. It passes without any check when req.serverCache is unset, which is the DM and ticket case because channelVerification sets serverCache only for server channels, so a DM route that uses it gets no role check there. With continueOnError the failure is written to req.errorMessage and the request continues; channelMessageDelete uses this so a message's author can delete their own message without MANAGE_CHANNELS, and the route refuses everyone else with that text. No caller in src passes ignoreAdmin.
