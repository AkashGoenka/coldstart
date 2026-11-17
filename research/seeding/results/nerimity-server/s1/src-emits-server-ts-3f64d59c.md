---
id: src-emits-server-ts-3f64d59c
type: file
character: single
title: "src/emits/Server.ts"
anchors:
  - {"path":"src/emits/Server.ts","symbols":["emitServerMessageCreated","emitServerMessageUpdated"],"hash":"sha256:f580b2e966a8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:58.477Z
edits: 1
---

# src/emits/Server.ts

emitServerMessageCreated broadcasts MESSAGE_CREATED to the channel room. When a socketId is passed it uses io.in(channelId).except(socketId) for everyone else, with socketId stripped from their payload, and sends the sender's socket its own copy with socketId intact. Without a socketId the whole channel room receives it. The emit is not conditioned on message.silent; only the push path checks silent.
