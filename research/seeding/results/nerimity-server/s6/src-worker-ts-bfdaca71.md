---
id: src-worker-ts-bfdaca71
type: file
character: single
title: "src/worker.ts"
anchors:
  - {"path":"src/worker.ts","symbols":["main","OpenGraphRouter","rateLimit"],"hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.808Z
edits: 2
---

# src/worker.ts

Worker entry for both process types. Every router module is imported at load for api and ws; only the app.use mounting is gated by env.TYPE === 'api'. Order inside the gate: express.json and urlencoded (20MB), userIP, OpenGraphRouter at /api, global_limit rateLimit, /api/status, then 16 routers in the order Moderation, Users, Servers, Channels, Friends, Explore, Posts, Connections, Tickets, Emojis, Tenor, Applications, Reminders, Webhooks, Oauth2, Cdn. OpenGraphRouter sits before the global limit, and its handler calls next() when no post id is found. 'query parser' is set to simple. No error-handling middleware is registered. Listens on WS_PORT (ws) or API_PORT only after prisma connects.
