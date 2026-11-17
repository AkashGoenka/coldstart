---
id: src-emits-server-ts-3f64d59c
type: file
character: single
title: "src/emits/Server.ts"
anchors:
  - {"path":"src/emits/Server.ts","symbols":["emitServerMessageCreated","emitServerJoined","emitServerLeft","emitServerRoleCreated"],"hash":"sha256:f580b2e966a8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.921Z
edits: 2
---

# src/emits/Server.ts

emitServerMessageCreated emits to the room named by channelId (not the server room); with a socketId it sends to the channel except that socket, then to that socket alone. emitServerRoleCreated broadcasts to the server-id room. emitServerJoined moves the user's sockets into the server room and each permitted channel room with socketsJoin; emitServerLeft on the serverDeleted branch only does socketsLeave(serverId) and does not remove sockets from channel rooms, while the user-leave branch removes both.
