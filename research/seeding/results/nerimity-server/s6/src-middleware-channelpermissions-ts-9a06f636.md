---
id: src-middleware-channelpermissions-ts-9a06f636
type: file
character: single
title: "src/middleware/channelPermissions.ts"
anchors:
  - {"path":"src/middleware/channelPermissions.ts","symbols":["channelPermissions"],"hash":"sha256:f495e5496f26","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.857Z
edits: 2
---

# src/middleware/channelPermissions.ts

Check order: no server (DM, ticket) returns next(); then server owner; then role ADMIN bit on req.serverMemberCache.permissions; only then the channel bit on req.channelCache.permissions, so owner and ADMIN ignore channel overrides. 403 uses the message passed in options. The invert option exists but no caller passes it.
