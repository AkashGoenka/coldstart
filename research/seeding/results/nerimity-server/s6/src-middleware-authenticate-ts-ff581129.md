---
id: src-middleware-authenticate-ts-ff581129
type: file
character: single
title: "src/middleware/authenticate.ts"
anchors:
  - {"path":"src/middleware/authenticate.ts","symbols":["authenticate"],"hash":"sha256:ddf71e34f0ec","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.825Z
edits: 2
---

# src/middleware/authenticate.ts

Passes the raw Authorization header (no Bearer parsing) to authenticateUser, and only then rejects bot accounts with 401 unless the route passes allowBot, so a rejected bot has already caused the device write and IP-ban side effects. Missing header is 401 unless allowNoToken, in which case req.userCache stays unset. Bot-capable routes opt in per route, e.g. channelMessageCreate and serverRoleCreate.
