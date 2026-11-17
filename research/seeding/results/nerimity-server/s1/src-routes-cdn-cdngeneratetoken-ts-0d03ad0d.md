---
id: src-routes-cdn-cdngeneratetoken-ts-0d03ad0d
type: file
character: single
title: "src/routes/cdn/cdnGenerateToken.ts"
anchors:
  - {"path":"src/routes/cdn/cdnGenerateToken.ts","symbols":["cdnGenerateToken"],"hash":"sha256:9b8991f19e2f","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.330Z
edits: 1
---

# src/routes/cdn/cdnGenerateToken.ts

POST /api/cdn/token (mounted from src/worker.ts under /api) mints a CDN token for the caller's user id only: generateToken is called without channelId, so this route does not scope the token to a channel. Its only gates are authenticate({ allowBot: true }) and a rate limit of 5 requests per 30 seconds; the supporter and public-server checks live in ChannelCdnGenerateToken.ts instead. The response is just { token }, and any CDN failure becomes a 400 'Could not generate token.'
