---
id: src-common-redis-ts-c42046fc
type: file
character: single
title: "src/common/redis.ts"
anchors:
  - {"path":"src/common/redis.ts","symbols":["customRedisFlush","connectRedis"],"hash":"sha256:e220abec1c29","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:52.834Z
edits: 1
---

# src/common/redis.ts

customRedisFlush is called only once, by the primary in src/index.ts, before any fork, so cluster children never flush. It takes keys('*'), drops POST_VIEWS keys and mq:/mq- keys for both types, then: a ws boot keeps only keys with a WS_KEYS prefix and deletes them; an api boot deletes every remaining key. So each api boot wipes all api-owned cache keys (users, servers and similar), and each ws boot wipes the ws-owned presence, voice and socket keys.
