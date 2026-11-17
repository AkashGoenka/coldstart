---
id: src-socket-events-ondisconnect-ts-e3fa1145
type: file
character: single
title: "src/socket/events/onDisconnect.ts"
anchors:
  - {"path":"src/socket/events/onDisconnect.ts","hash":"sha256:f1faaf463fff","head":"feb30ff9ac54","symbols":["onDisconnect","handleDisconnect"]}
status: active
updated: 2026-11-17T03:24:47.368Z
edits: 3
---

# src/socket/events/onDisconnect.ts

Voice cleanup runs at the end of handleDisconnect and only when the stored voice socketId equals the disconnecting socket. It does not consult isLastDisconnect, so closing the voice socket ends the call even while the user has other sockets connected. leaveVoiceChannel is called without await. The prisma user lookup returns early when the user row is missing, which skips voice cleanup. socketDisconnect runs earlier and deletes the socket-to-user key, but userId was read first, so the voice lookup still works.
