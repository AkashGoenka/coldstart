---
id: src-socket-events-onconnection-ts-a7ed098e
type: file
character: single
title: "src/socket/events/onConnection.ts"
anchors:
  - {"path":"src/socket/events/onConnection.ts","symbols":["onConnection"],"hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.850Z
edits: 2
---

# src/socket/events/onConnection.ts

A 30s timer errors with 'Authentication timed out' and disconnects a socket that has not emitted AUTHENTICATE; the flag is set on receipt of the event, not on success, so a socket whose auth is queued or failing is not cut by this timer.
