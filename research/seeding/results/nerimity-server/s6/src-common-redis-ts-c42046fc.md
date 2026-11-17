---
id: src-common-redis-ts-c42046fc
type: file
character: single
title: "src/common/redis.ts"
anchors:
  - {"path":"src/common/redis.ts","symbols":["customRedisFlush","connectRedis"],"hash":"sha256:e220abec1c29","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.814Z
edits: 2
---

# src/common/redis.ts

customRedisFlush runs once, from the primary at boot. On ws it deletes only keys under WS_KEYS prefixes; otherwise it deletes every key outside WS_KEYS, so an api restart wipes session, user, server, channel and rate-limit caches. POST_VIEWS and 'mq:' / 'mq-' keys are always kept. connectRedis rejects on any 'error' event, but only the first settle matters.
