---
id: how-sockets-get-into-rooms-and-how-emits-reach-them-across-p
type: flow
title: "how sockets get into rooms and how emits reach them across processes"
anchors:
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/socket/socket.ts","hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onConnection.ts","hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onAuthenticate.ts","hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/emits/User.ts","hash":"sha256:ead0d32c2e5f","head":"feb30ff9ac54"}
  - {"path":"src/emits/Server.ts","hash":"sha256:f580b2e966a8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.036Z
edits: 1
---

# how sockets get into rooms and how emits reach them across processes

The primary and every cluster worker install the same redis-streams adapter, so an emit issued in any process (including the api process's primary-created io) reaches sockets held by another process. Room membership is written only by the socket itself in handleAuthenticate and by emitServerJoined/emitServerLeft via socketsJoin/socketsLeave; rooms are plain ids (userId, 'ses:'+sessionId, server ids, channel ids). A socket that never authenticates is in no user, server or channel room.

## Steps

1. `src/socket/socket.ts` (`createIO`, `emitToAll`) — io creation with adapter; emitToAll targets serverIds + friendIds + userId rooms after two prisma lookups
2. `src/socket/events/onConnection.ts` (`onConnection`) — 30s timer that disconnects only if no AUTHENTICATE event was received
3. `src/socket/events/onAuthenticate.ts` (`onAuthenticate`, `handleAuthenticate`) — concurrency-1 PQueue, authenticateUser, joins ses room, user room, server rooms and permitted channel rooms
4. `src/cache/UserCache.ts` (`addSocketUser`, `socketDisconnect`) — per-user socket set in redis; gates the presence broadcast on first connect and last disconnect
5. `src/emits/User.ts` (`emitUserPresenceUpdate`, `emitUserUpdated`) — presence and user-updated emits through emitToAll
6. `src/emits/Server.ts` (`emitServerJoined`, `emitServerLeft`, `emitServerMessageCreated`) — moves member sockets between rooms and fans messages out to channel rooms

## Invariants

- emitToAll always appends userId to its room list, so its empty-array guard (the comment warns an empty array broadcasts to everyone) cannot fire through it.
- The PQueue is module-level, so auth serialization is per process, not per cluster.
- The 30s timeout checks a flag set when AUTHENTICATE is received, not when it succeeds.
- Presence is broadcast on a user's first socket and last disconnect; isFirstConnect is read with sCard before sAdd, so it is not atomic across processes.
