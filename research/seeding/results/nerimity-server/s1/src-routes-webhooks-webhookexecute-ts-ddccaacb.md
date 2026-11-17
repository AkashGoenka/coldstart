---
id: src-routes-webhooks-webhookexecute-ts-ddccaacb
type: file
character: single
title: "src/routes/webhooks/webhookExecute.ts"
anchors:
  - {"path":"src/routes/webhooks/webhookExecute.ts","symbols":["rateLimitCheck","webhookkExecute","route"],"hash":"sha256:a453030c0955","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.476Z
edits: 2
---

# src/routes/webhooks/webhookExecute.ts

Check order is part of the behavior: the express-validator limits, the content-required check and the username bad-word check all run before `webhookAuthenticate`, so those 400s are returned to unauthenticated callers. After auth, the rate limit is keyed `<channelId>-wh-exec` at 10 requests per 5 seconds and is skipped when DEV_MODE is set. The avatarUrl check here only calls `new URL()`, so any scheme that parses is accepted at this point.
