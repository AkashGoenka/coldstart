---
id: src-middleware-channelpermissions-ts-9a06f636
type: file
character: single
title: "src/middleware/channelPermissions.ts"
anchors:
  - {"path":"src/middleware/channelPermissions.ts","symbols":["channelPermissions"],"hash":"sha256:f495e5496f26","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.324Z
edits: 1
---

# src/middleware/channelPermissions.ts

Tests one bit of req.channelCache.permissions and returns next() before reading it in three cases: the channel has no server (DM and ticket), the requester is the server creator, or req.serverMemberCache.permissions has the role ADMIN bit. The invert option flips the test to refuse when the bit is set, and no caller in src passes invert.
