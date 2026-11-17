---
id: src-socket-events-onvoicesignal-ts-73337c93
type: file
character: single
title: "src/socket/events/onVoiceSignal.ts"
anchors:
  - {"path":"src/socket/events/onVoiceSignal.ts","hash":"sha256:3fe7028d1ce7","head":"feb30ff9ac54","symbols":["Payload","onVoiceSignal"]}
status: active
updated: 2026-11-17T03:24:47.364Z
edits: 3
---

# src/socket/events/onVoiceSignal.ts

A signal is relayed only if getUserIdBySocketId(socket.id) gives a user whose voice entry has socketId equal to socket.id, and the recipient payload.toUserId has a voice entry with the same channelId. The emit goes to the recipient's stored socketId, with fromUserId taken from Redis rather than the payload, and it forwards payload.channelId and payload.signal unchecked against either side. Any failed check returns silently, with no error sent back. The mimiqueue-based queue at the top of the file is commented out, so signals are relayed immediately.
