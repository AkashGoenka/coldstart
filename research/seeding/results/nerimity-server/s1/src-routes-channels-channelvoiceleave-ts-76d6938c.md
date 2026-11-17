---
id: src-routes-channels-channelvoiceleave-ts-76d6938c
type: file
character: single
title: "src/routes/channels/channelVoiceLeave.ts"
anchors:
  - {"path":"src/routes/channels/channelVoiceLeave.ts","hash":"sha256:46a707077569","head":"feb30ff9ac54","symbols":["channelVoiceLeave","route"]}
status: active
updated: 2026-11-17T03:24:47.376Z
edits: 3
---

# src/routes/channels/channelVoiceLeave.ts

POST /channels/:channelId/voice/leave runs channelVerification on the URL channel, but the route calls leaveVoiceChannel(req.userCache.id) with no channel id. The leave therefore applies to whichever voice channel the caller is in, not necessarily the one in the URL. leaveVoiceChannel accepts a channelId and rejects a mismatch, but this route never passes it. Errors return 403.
