---
id: src-middleware-ratelimit-ts-fb1bdf10
type: file
character: single
title: "src/middleware/rateLimit.ts"
anchors:
  - {"path":"src/middleware/rateLimit.ts","symbols":["rateLimit"],"hash":"sha256:637f3c74f331","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:45.489Z
edits: 1
---

# src/middleware/rateLimit.ts

Under DEV_MODE this limiter is a no-op unless the request body has `test_enable_rate_limit`. When `test_enable_rate_limit_restrict_ms` is also sent, the middleware overwrites `opts.perMS` and `opts.restrictMS` on the closure's shared options object, so later flagged requests on that route keep the overwritten values after the test request. The key is the user id (or the IP when `useIP`) plus `-<name>`; `globalLimit` keys on `name` alone. `perMS` falls back to `restrictMS`, and a blocked request gets 429 with the TTL in ms, unless `nextIfRatedLimited` is set, in which case it calls next().
