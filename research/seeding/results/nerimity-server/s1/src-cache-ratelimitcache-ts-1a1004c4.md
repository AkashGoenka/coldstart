---
id: src-cache-ratelimitcache-ts-1a1004c4
type: file
character: single
title: "src/cache/RateLimitCache.ts"
anchors:
  - {"path":"src/cache/RateLimitCache.ts","symbols":["checkAndUpdateRateLimit"],"hash":"sha256:aa9c56fc8676","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:45.492Z
edits: 1
---

# src/cache/RateLimitCache.ts

Each limit window is one Redis hash: the first hit creates it with PEXPIRE perMS and returns allowed; later hits HINCRBY `requests`, and the hit that reaches `requests` sets status REACHED. With resetTTLOnLimit (default on) that hit re-expires the window to restrictMS, and while REACHED every call returns the remaining PTTL without counting. The three-strike counter is a separate key, created only when a callback is passed, with a 3-minute expiry set on its first count; the third count deletes it and returns -2, which makes the function call the callback without awaiting it and return the window's PTTL.
