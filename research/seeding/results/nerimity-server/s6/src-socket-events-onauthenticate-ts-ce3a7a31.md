---
id: src-socket-events-onauthenticate-ts-ce3a7a31
type: file
character: single
title: "src/socket/events/onAuthenticate.ts"
anchors:
  - {"path":"src/socket/events/onAuthenticate.ts","symbols":["onAuthenticate","handleAuthenticate"],"hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.846Z
edits: 2
---

# src/socket/events/onAuthenticate.ts

Socket auth is serialized by a module-level PQueue with concurrency 1 (per process, not per cluster); queued sockets get USER_AUTH_QUEUE_POSITION every 5s. handleAuthenticate calls authenticateUser and joins 'ses:'+sessionId before checking the auth error, so a rejected socket is in the ses room until it disconnects, and there is no bot check on this path (bots just skip the inbox). Room joins: a server creator joins every channel; others join a channel when their combined role permissions include PUBLIC_CHANNEL or serverMemberHasPermission finds ADMIN. The IP comes from cf-connecting-ip, x-forwarded-for, then handshake address.
