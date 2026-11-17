---
id: how-nerimity-server-is-put-together-api-and-ws-processes-2
type: flow
title: "how nerimity-server is put together (api and ws processes)"
anchors:
  - {"path":"src/common/env.ts","hash":"sha256:441ad23aa05d","head":"feb30ff9ac54"}
  - {"path":"ecosystem.config.js","hash":"sha256:91ea3f2a0e76","head":"feb30ff9ac54"}
  - {"path":"tsdown.ws.config.ts","hash":"sha256:0683262b8101","head":"feb30ff9ac54"}
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/common/redis.ts","hash":"sha256:e220abec1c29","head":"feb30ff9ac54"}
  - {"path":"src/cache/CacheKeys.ts","hash":"sha256:71c6dc8781da","head":"feb30ff9ac54"}
  - {"path":"src/socket/socket.ts","hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onConnection.ts","hash":"sha256:f1c7a9691ac0","head":"feb30ff9ac54"}
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:52.811Z
edits: 1
---

# how nerimity-server is put together (api and ws processes)

The process type is fixed by one argv test in src/common/env.ts (`--ws` means ws, anything else means api), and every api-only piece is gated on it: the schedulers in src/index.ts and the /api middleware and routers in src/worker.ts never run in the ws process. Only the primary process flushes Redis, and it does so before forking, so workers never flush. Workers call listen only after Postgres connects, and any worker exit makes the primary call process.exit.

## Steps

1. `src/common/env.ts` (`TYPE`) — TYPE is 'ws' only when process.argv includes '--ws'; any other argv, including '--api', resolves to 'api'. Forked cluster children inherit argv, so they resolve the same TYPE as their primary.
2. `ecosystem.config.js` — pm2 apps neri-api and neri-ws run the npm scripts start-api and start-ws, which build and launch dist/api and dist/ws with the --api and --ws flags. The process type is chosen by the launch argument, not by a config key.
3. `tsdown.ws.config.ts` — the ws bundle is built from the same src/index.ts with a plugin that regex-removes every app.use('/api'...) statement from transformed modules. Only those /api mounts are stripped; the TYPE check still runs at runtime, so the rest of the api branch stays in the ws bundle.
4. `src/index.ts` (`cluster`, `customRedisFlush`, `createQueueProcessor`, `createIO`) — primary branch (cluster.isPrimary): awaits connectRedis, customRedisFlush and createQueueProcessor({prefix: TYPE}), calls createIO() with no http server, forks min(3, cpus) workers (1 when DEV_MODE) each with CLUSTER_INDEX, and calls process.exit on any worker exit. Non-primary processes run import('./worker').
5. `src/common/redis.ts` (`customRedisFlush`) — startup flush, run once by the primary before forking: takes keys('*'), drops POST_VIEWS keys and mq:/mq- keys for both types, then a ws primary keeps only keys with a WS_KEYS prefix and deletes them, and an api primary deletes all the rest.
6. `src/cache/CacheKeys.ts` (`WS_KEYS`) — the ws-owned prefixes: socket.io adapter keys, connected socket and user ids, voice user and voice channel sets, user presence. The flush treats every other prefix as api-owned.
7. `src/socket/socket.ts` (`createIO`) — socket.io server with websocket-only transport and the redis-streams adapter. The primary calls it with no server (adapter only); each worker calls it with its own http server.
8. `src/socket/events/onConnection.ts` (`onConnection`) — per connection: a 30s timer after which a socket that never sent AUTHENTICATE gets an 'Authentication timed out' error with disconnect: true.
9. `src/worker.ts` (`main`, `rateLimit`, `createIO`) — each forked child: main() runs connectRedis and createIO(server); Express always mounts helmet and cors; for TYPE api only it adds json/urlencoded (20MB), userIP, the OpenGraph router, a global rateLimit, /api/status and the routers. server.listen on API_PORT (api) or WS_PORT (ws) runs only after this process's Prisma connect.

## Invariants

- A process started without --ws is an api process: it runs the schedulers and mounts the /api routers. The ws process must be started with --ws.
- The periodic schedulers start only in the api primary, after Prisma connects; no cluster child starts them.
- The startup flush runs only in the primary and before any fork. Every api boot deletes all api-owned redis keys, so a redis key owned by the ws process must be listed in WS_KEYS or the api process deletes it on its next boot.
- A REST route is reachable only if its router is mounted in src/worker.ts inside the TYPE === 'api' branch.
- A new client-to-server socket event needs a socket.on in src/socket/events/onConnection.ts.
