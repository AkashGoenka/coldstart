---
id: src-socket-events-onconnection-ts-a7ed098e
type: file
character: single
title: "src/socket/events/onConnection.ts"
anchors:
  - {"path":"src/socket/events/onConnection.ts","symbols":["onConnection"],"hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:05.476Z
edits: 1
---

# src/socket/events/onConnection.ts

Each socket gets a 30 s timer that emits 'Authentication timed out' and disconnects unless an AUTHENTICATE event has arrived. The flag is set when the event arrives, not when the login succeeds, so a login that fails or is still queued passes the timer. The AUTHENTICATE listener has no once-guard: every event calls onAuthenticate again, and each successful run emits AUTHENTICATED again.
