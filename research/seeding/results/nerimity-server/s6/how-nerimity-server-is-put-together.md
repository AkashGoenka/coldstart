---
id: how-nerimity-server-is-put-together
type: flow
title: "how nerimity-server is put together"
anchors:
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/middleware/authenticate.ts","hash":"sha256:ddf71e34f0ec","head":"feb30ff9ac54"}
  - {"path":"src/middleware/channelVerification.ts","hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
  - {"path":"src/middleware/rateLimit.ts","hash":"sha256:637f3c74f331","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/MessageCreate.ts","hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onAuthenticate.ts","hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/isModMiddleware.ts","hash":"sha256:dfb3a4a12710","head":"feb30ff9ac54"}
  - {"path":"src/services/User/UserManagement.ts","hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.058Z
edits: 1
---

# how nerimity-server is put together

One TypeScript bundle (Express + socket.io + Prisma + Redis) runs as two processes selected by the --ws flag: 'api' serves /api HTTP and the scheduled cleanup jobs, 'ws' serves the websocket only, and both share Redis through the socket.io redis-streams adapter. Each process is a cluster primary that forks up to 3 workers. Authorization is composed per route from middleware, and state is cached in Redis with explicit invalidation.

## Steps

1. `src/index.ts` (`cluster`, `scheduleServerDeletion`, `scheduleDeleteAccountContent`) — entry: Redis flush, primary-only socket.io, worker fork, api-only scheduled jobs
2. `src/worker.ts` (`main`) — worker: HTTP server, middleware order and /api router mounts (api only)
3. `src/middleware/authenticate.ts` (`authenticate`) — token to cached user (see the auth flow)
4. `src/middleware/channelVerification.ts` (`channelVerification`) — channel and server permission layers (see the permission flow)
5. `src/middleware/rateLimit.ts` (`rateLimit`) — Redis Lua rate limiting
6. `src/services/Message/MessageCreate.ts` (`createMessageV2`) — message write path and fan-out
7. `src/socket/events/onAuthenticate.ts` (`handleAuthenticate`) — socket auth and room joins
8. `src/routes/moderation/isModMiddleware.ts` (`isModMiddleware`) — badge-gated moderation routes
9. `src/services/User/UserManagement.ts` (`deleteAccount`) — account deletion feeding the background purge jobs

## Invariants

- Anything api-only is gated on env.TYPE === 'api'.
- Redis keys not listed in WS_KEYS are cleared on every api boot.
- The only automated tests are under tests/users and tests/servers.
