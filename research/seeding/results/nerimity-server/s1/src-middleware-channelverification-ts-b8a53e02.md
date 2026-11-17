---
id: src-middleware-channelverification-ts-b8a53e02
type: file
character: single
title: "src/middleware/channelVerification.ts"
anchors:
  - {"path":"src/middleware/channelVerification.ts","symbols":["channelVerification"],"hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.320Z
edits: 1
---

# src/middleware/channelVerification.ts

Runs first on every /channels/:channelId route. For server channels it sets req.serverCache and req.serverMemberCache; for DM channels it admits only the inbox recipient or creator; for ticket channels it admits the creator or a user whose site-wide badges include ADMIN or FOUNDER, not a server role ADMIN. After those checks it always calls channelPermissions with PUBLIC_CHANNEL, so a non-owner, non-role-ADMIN member without that channel bit gets 'This channel is private.' even on routes that pass no bit of their own. The scheduled-deletion 403 is skipped only when ignoreScheduledDeletion is set, and the allowBot option is declared but never read in this file.
