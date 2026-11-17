---
id: src-routes-channels-channelvoicejoin-ts-bc2d5456
type: file
character: single
title: "src/routes/channels/channelVoiceJoin.ts"
anchors:
  - {"path":"src/routes/channels/channelVoiceJoin.ts","hash":"sha256:db5e52be489b","head":"feb30ff9ac54","symbols":["channelVoiceJoin","route"]}
status: active
updated: 2026-11-17T03:24:47.372Z
edits: 3
---

# src/routes/channels/channelVoiceJoin.ts

Gates run in order: authenticate, channelVerification, channelPermissions with JOIN_VOICE, rateLimit at 10 requests per 20 seconds, then the socketId body check of 3 to 320 characters. In the route, validation errors return 400, a shadow-banned caller gets {success: true} with no join, and a non-bot account without a confirmed email gets 400 before joinVoiceChannel runs. Any joinVoiceChannel error returns 403. The socketId is not required to be the calling request's socket, only one that maps to the caller.
