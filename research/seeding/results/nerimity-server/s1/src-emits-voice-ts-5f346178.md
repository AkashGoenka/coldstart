---
id: src-emits-voice-ts-5f346178
type: file
character: single
title: "src/emits/Voice.ts"
anchors:
  - {"path":"src/emits/Voice.ts","hash":"sha256:9c2da45a654d","head":"feb30ff9ac54","symbols":["emitServerVoiceUserJoined","emitServerVoiceUserLeft","emitDMVoiceUserJoined","emitDMVoiceUserLeft"]}
status: active
updated: 2026-11-17T03:24:47.384Z
edits: 3
---

# src/emits/Voice.ts

Server-channel joins and leaves go to io.in(channelId), so only sockets in that room receive them. onAuthenticate joins a socket to a channel room only for the channel creator, public channels, and members with ADMIN permission, so other members do not receive voice events for that channel. DM events go to the two inbox user ids (recipientId, createdById). The joined payload is the record from addUserToVoice with channelId, serverId and userId and no socketId; the left payload is {userId, channelId}.
