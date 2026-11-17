---
id: src-middleware-channelverification-ts-b8a53e02
type: file
character: single
title: "src/middleware/channelVerification.ts"
anchors:
  - {"path":"src/middleware/channelVerification.ts","symbols":["channelVerification"],"hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.853Z
edits: 2
---

# src/middleware/channelVerification.ts

Always finishes by running channelPermissions(PUBLIC_CHANNEL, 'This channel is private.') itself, so that check is not a separate entry in route chains. Server-channel logic (member lookup into req.serverMemberCache, req.serverCache, scheduled-for-deletion 403 unless ignoreScheduledDeletion) applies to SERVER_TEXT and CATEGORY only. TICKET channels admit only the ticket creator or a site user with the USER_BADGES ADMIN or FOUNDER badge (not the server role ADMIN bit); DMs check recipient/creator.
