---
id: src-cache-ratelimitcache-ts-1a1004c4
type: file
character: single
title: "src/cache/RateLimitCache.ts"
anchors:
  - {"path":"src/cache/RateLimitCache.ts","symbols":["checkAndUpdateRateLimit","RATE_LIMIT_SCRIPT"],"hash":"sha256:aa9c56fc8676","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.896Z
edits: 2
---

# src/cache/RateLimitCache.ts

One Lua script: the counter hash is created on the first request with PEXPIRE perMS and later allowed requests only HINCRBY, so the window is fixed, not sliding. At the limit it sets REACHED and returns remaining PTTL without counting; the block length is restrictMS unless resetTTLOnLimit is false. The iteration counter increments only on the transition to REACHED, expires after 3 minutes, and on the 3rd transition is deleted and -2 is returned, which makes JS call onThreeIterations and then read a separate PTTL. Returns false when allowed.
