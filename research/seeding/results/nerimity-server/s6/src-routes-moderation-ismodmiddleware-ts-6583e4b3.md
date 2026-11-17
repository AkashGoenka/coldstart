---
id: src-routes-moderation-ismodmiddleware-ts-6583e4b3
type: file
character: single
title: "src/routes/moderation/isModMiddleware.ts"
anchors:
  - {"path":"src/routes/moderation/isModMiddleware.ts","symbols":["isModMiddleware"],"hash":"sha256:dfb3a4a12710","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.930Z
edits: 2
---

# src/routes/moderation/isModMiddleware.ts

Tests badge bits on req.userCache.badges (so authenticate() must run first, in each route file; ModerationRouter adds none): FOUNDER or ADMIN, or MOD when allowModBadge is true. It sets req.hasAdminOrCreatorBadge before the MOD branch, so a MOD admitted this way has the flag false, and handlers such as getUser use that to hide emails and IPs and to refuse FOUNDER/ADMIN targets. Rejection is 403 'Admin access only!'.
