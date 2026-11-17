---
id: src-socket-events-onauthenticate-ts-ce3a7a31
type: file
character: single
title: "src/socket/events/onAuthenticate.ts"
anchors:
  - {"path":"src/socket/events/onAuthenticate.ts","symbols":["onAuthenticate","handleAuthenticate","addWithPosition"],"hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:05.471Z
edits: 1
---

# src/socket/events/onAuthenticate.ts

The whole handleAuthenticate body runs inside a module-level PQueue({ concurrency: 1 }), so logins are serialized per process and one slow login holds up every queued socket. A queued socket gets user:auth_queue_position every 5 s, and the first one only after 5 s because setInterval has no immediate tick. On success the socket joins the user id, every server in the user's list, and channel ids where the member's combined role permissions include PUBLIC_CHANNEL or a role holds ADMIN; a server creator gets every channel, and the channel loop skips a server the member row is missing for. The 'ses:' + sessionId room is joined before the authenticateUser error check, so a rejected login stays in it until emitError disconnects the socket.
