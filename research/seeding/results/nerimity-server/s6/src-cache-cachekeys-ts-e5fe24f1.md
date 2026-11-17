---
id: src-cache-cachekeys-ts-e5fe24f1
type: file
character: single
title: "src/cache/CacheKeys.ts"
anchors:
  - {"path":"src/cache/CacheKeys.ts","symbols":["WS_KEYS","RATE_LIMIT_KEY_STRING","RATE_LIMIT_ITTER_KEY_STRING"],"hash":"sha256:71c6dc8781da","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.818Z
edits: 2
---

# src/cache/CacheKeys.ts

WS_KEYS (socket.io, connected-socket set, socket-to-user key, voice hash and set, presence key) is the only list of ws-owned prefixes; every other key here is cleared by an api boot, so a new key written from ws-side code must be added to WS_KEYS. Rate-limit keys are NERIMITY_RATE_LIMIT:<id> and NERIMITY_RATE_LIMIT_ITTER:<id>.
