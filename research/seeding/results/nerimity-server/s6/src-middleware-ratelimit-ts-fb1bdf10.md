---
id: src-middleware-ratelimit-ts-fb1bdf10
type: file
character: single
title: "src/middleware/rateLimit.ts"
anchors:
  - {"path":"src/middleware/rateLimit.ts","symbols":["rateLimit"],"hash":"sha256:637f3c74f331","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.892Z
edits: 2
---

# src/middleware/rateLimit.ts

In DEV_MODE the limiter is skipped unless req.body.test_enable_rate_limit is set (tests/servers/createServerMessage.test.ts uses it), and test_enable_rate_limit_restrict_ms mutates the shared opts object captured by the closure, so the change persists for later requests on that route. Key id is the user id (or oAuth2 grant user, else IP) plus '-' + name; useIP forces IP; globalLimit uses the bare name, shared by all clients. perMS falls back to restrictMS. A blocked request gets 429 with generateError(message or 'Slow down!') plus ttl in ms; nextIfRatedLimited exists but no caller uses it.
