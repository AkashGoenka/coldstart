---
id: src-services-voice-ts-40bc40cd
type: file
character: single
title: "src/services/Voice.ts"
anchors:
  - {"path":"src/services/Voice.ts","hash":"sha256:91045b3802ea","head":"feb30ff9ac54","symbols":["generateTurnCredentials","joinVoiceChannel","leaveVoiceChannel"]}
status: active
updated: 2026-11-17T03:24:47.349Z
edits: 3
---

# src/services/Voice.ts

joinVoiceChannel leaves any current call before validating the target channel, and it refuses a socketId unless getUserIdBySocketId maps it to the caller. For DM channels it refuses when a friend row with status BLOCKED exists in either direction. When the channel has no voice users it fires a CALL_STARTED system message without awaiting it, then writes membership. leaveVoiceChannel returns an error before removeVoiceUserByUserId when the channel cache lookup fails, so the Redis entry remains in that case. generateTurnCredentials POSTs to Cloudflare's TURN key endpoint with a 86400 second TTL using the CLOUDFLARE_CALLS_ID and CLOUDFLARE_CALLS_TOKEN variables, returns null on a non-OK response, and does not catch a network error.
