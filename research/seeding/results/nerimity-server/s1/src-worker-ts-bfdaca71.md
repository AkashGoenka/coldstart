---
id: src-worker-ts-bfdaca71
type: file
character: single
title: "src/worker.ts"
anchors:
  - {"path":"src/worker.ts","symbols":["rateLimit","main","createIO"],"hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:52.825Z
edits: 2
---

# src/worker.ts

Runs only in forked children, never in the primary. main() calls connectRedis and createIO(server) immediately, but server.listen happens only inside prisma.$connect().then (guarded by server.listening), on API_PORT for api and WS_PORT for ws. Express always mounts helmet and cors. Inside if (env.TYPE === 'api') the order is json and urlencoded (20MB), userIP, the OpenGraph router under /api, a global rateLimit (useIP, requests 100, perMS 15000, restrictMS 30000), /api/status, then the routers, so requests the OpenGraph router answers never reach the rate limiter. The ws build (tsdown.ws.config.ts) strips the app.use('/api'...) lines from this file, but the TYPE check is still evaluated at runtime.
