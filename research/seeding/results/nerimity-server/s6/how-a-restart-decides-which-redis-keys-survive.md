---
id: how-a-restart-decides-which-redis-keys-survive
type: flow
title: "how a restart decides which Redis keys survive"
anchors:
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/common/redis.ts","hash":"sha256:e220abec1c29","head":"feb30ff9ac54"}
  - {"path":"src/cache/CacheKeys.ts","hash":"sha256:71c6dc8781da","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.054Z
edits: 1
---

# how a restart decides which Redis keys survive

The flush is chosen by process type, and the prefix list WS_KEYS in CacheKeys.ts is the only thing that protects a key from an api boot: on ws, customRedisFlush deletes only keys under WS_KEYS prefixes; on api it deletes every key outside them, so session, user, server, channel and rate-limit caches are all gone after an api restart. Keys with the POST_VIEWS prefix and 'mq:' / 'mq-' prefixes survive in both modes.

## Steps

1. `src/index.ts` (`customRedisFlush`) — primary calls it after connectRedis and before forking workers
2. `src/common/redis.ts` (`customRedisFlush`) — KEYS('*') filtered by env.TYPE
3. `src/cache/CacheKeys.ts` (`WS_KEYS`) — prefix list of ws-owned keys (socket.io, connected sockets, socket-to-user, voice, presence)

## Invariants

- A key written by ws-side code must start with a WS_KEYS prefix, otherwise the next api boot deletes it.
- User cache entries and the server cache have no expiry, so after a flush they are rebuilt from the database on demand.
- The presence key has no expiry; a ws process that dies without disconnect handling leaves it until the next ws boot flush.
