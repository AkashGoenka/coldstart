---
id: src-socket-events-onchangeactivity-ts-0dfd56d7
type: file
character: single
title: "src/socket/events/onChangeActivity.ts"
anchors:
  - {"path":"src/socket/events/onChangeActivity.ts","symbols":["onChangeActivity"],"hash":"sha256:5e45c1e5f515","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:45.504Z
edits: 1
---

# src/socket/events/onChangeActivity.ts

Activity updates are throttled by a direct checkAndUpdateRateLimit call, not the middleware: 10 per 5 s per user with a 10 s block. A blocked update is dropped silently, with no error sent to the socket, and this path has no DEV_MODE gate. Accepted updates continue into debouncedChangeActivity. No onThreeIterations callback is passed, so repeated activity spam never produces a ban.
