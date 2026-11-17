---
id: how-the-api-and-ws-processes-boot-from-one-bundle
type: flow
title: "how the api and ws processes boot from one bundle"
anchors:
  - {"path":"src/common/env.ts","hash":"sha256:441ad23aa05d","head":"feb30ff9ac54"}
  - {"path":"tsdown.ws.config.ts","hash":"sha256:0683262b8101","head":"feb30ff9ac54"}
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/socket/socket.ts","hash":"sha256:0cde49834e8c","head":"feb30ff9ac54"}
  - {"path":"src/common/redis.ts","hash":"sha256:e220abec1c29","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.007Z
edits: 1
---

# how the api and ws processes boot from one bundle

The ws build is not a separate program: both bundles are built from the same src/index.ts, the ws build strips the app.use('/api' ...) mounts with a regex plugin, and the runtime switch is env.TYPE, which is 'ws' only when argv contains --ws (any other invocation, including the --api in package.json, is 'api'). Route modules are still imported in the ws process, so module-level side effects in route files (e.g. the hourly setInterval in routes/tenor/getTenorCategories.ts) run in both types. The primary process never listens: it connects redis, flushes keys, creates socket.io with no http server (emit-only via the redis adapter), forks up to 3 workers (1 in DEV_MODE), and on api only registers the scheduled jobs.

## Steps

1. `src/common/env.ts` (`TYPE`) — TYPE from the --ws argv flag; every api-only gate reads it
2. `tsdown.ws.config.ts` (`exclusions`) — build-time plugin that deletes app.use('/api' ...) statements from the ws bundle; the runtime env.TYPE gate still exists
3. `src/index.ts` (`cluster`, `customRedisFlush`, `createIO`) — primary branch: connectRedis, customRedisFlush, createIO(), prisma.$connect, fork loop; scheduled jobs only when TYPE is api
4. `src/worker.ts` (`main`) — worker branch: connectRedis, createIO(server), mounts Express routers only when TYPE is api, listens on WS_PORT or API_PORT after prisma connects
5. `src/socket/socket.ts` (`createIO`) — socket.io with websocket-only transport and the redis-streams adapter, created in primary and in every worker

## Invariants

- Any api-only behavior must sit behind env.TYPE === 'api' in index.ts or worker.ts.
- Any worker 'exit' event makes the primary call process.exit(code); nothing re-forks a worker, so a worker death restarts the whole cluster and re-runs the boot flush.
- Workers are forked before prisma.$connect resolves in the primary; each worker waits on its own prisma connection before listening.
