---
id: src-routes-channels-channelvoicegeneratecredentials-ts-adb90e44
type: file
character: single
title: "src/routes/channels/channelVoiceGenerateCredentials.ts"
anchors:
  - {"path":"src/routes/channels/channelVoiceGenerateCredentials.ts","hash":"sha256:5054c8aef01a","head":"feb30ff9ac54","symbols":["voiceGenerateCredentials","route"]}
status: active
updated: 2026-11-17T03:24:47.380Z
edits: 3
---

# src/routes/channels/channelVoiceGenerateCredentials.ts

POST /voice/generate is gated only by authenticate (bots allowed) and a rate limit of 3 requests per 20 seconds. It does not require the caller to be in a call or to hold any channel permission. It responds {result: iceServers} from generateTurnCredentials, or 403 when that returns null.
