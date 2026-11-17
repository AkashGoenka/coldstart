---
id: how-a-websocket-authenticates-and-gets-its-authenticated-pay
type: flow
title: "how a websocket authenticates and gets its AUTHENTICATED payload"
anchors:
  - {"path":"src/socket/events/onConnection.ts","hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onAuthenticate.ts","hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/common/serverMembeHasPermission.ts","hash":"sha256:7b2957b703fd","head":"feb30ff9ac54"}
  - {"path":"src/services/Server.ts","hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
  - {"path":"src/socket/socket.ts","hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:05.462Z
edits: 1
---

# how a websocket authenticates and gets its AUTHENTICATED payload

The whole authentication body runs inside one module-level PQueue with concurrency 1, so logins are serialized per process and one slow login holds up every queued socket. Room membership is decided once, at login: user id, server ids, and channel ids that pass the PUBLIC_CHANNEL or ADMIN check; later joins happen through socketsJoin calls in src/services/Channel.ts and src/emits/Server.ts, which are not traced here. The suspension and IP-ban checks do not run on every login: suspension runs only on a user-cache miss, and the IP-ban lookup runs only when the IP is missing from the allowed-IP set or differs from the cached user's ip.

## Steps

1. `src/socket/events/onConnection.ts` (`onConnection`) — registers the user:authenticate listener and starts the 30 s 'Authentication timed out' timer, which checks only whether an AUTHENTICATE event arrived
2. `src/socket/events/onAuthenticate.ts` (`onAuthenticate`, `addWithPosition`) — enqueues the login on the module-level concurrency-1 queue and starts the 5 s queue-position emitter
3. `src/cache/UserCache.ts` (`authenticateUser`, `getUserCacheBySessionId`, `storeUserCache`) — decrypts the token, maps session to user through Redis, runs suspension on cache miss, and applies the IP-ban and device-record branch
4. `src/socket/events/onAuthenticate.ts` (`handleAuthenticate`) — joins the session and user rooms, loads the user row, then joins server and channel rooms from the permission bits
5. `src/common/serverMembeHasPermission.ts` (`serverMemberHasPermission`) — the ADMIN test that lets a non-public channel be joined; the default role is included in the check
6. `src/services/Server.ts` (`getServers`) — loads the user's servers, channels, roles and (unless partial) members in one query; partial mode uses the presence-based member lookup
7. `src/cache/UserCache.ts` (`addSocketUser`) — records the socket id per user and writes presence only for the first socket; its return value decides whether a presence update is emitted
8. `src/socket/socket.ts` (`markMembersFetched`) — remembers which servers this socket already received members for, used only on the partial path

## Invariants

- All login work for sockets on one process goes through one queue, so queue position is reported only while the socket's id is still in waitingOrder.
- The user-id room and the server/channel rooms are joined only after the token, suspension and user checks pass; the 'ses:' session room is joined before the error return, so a rejected login is in that room until emitError disconnects the socket.
- A socket that disconnects after handleAuthenticate starts but before addSocketUser is not cleaned up by a return: onAuthenticate calls onDisconnect itself when socket.connected is false at that point.
