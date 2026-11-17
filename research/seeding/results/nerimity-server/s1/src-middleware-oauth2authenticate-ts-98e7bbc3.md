---
id: src-middleware-oauth2authenticate-ts-98e7bbc3
type: file
character: single
title: "src/middleware/oAuth2Authenticate.ts"
anchors:
  - {"path":"src/middleware/oAuth2Authenticate.ts","symbols":["oAuth2Authenticate"],"hash":"sha256:b58635db5e81","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.467Z
edits: 1
---

# src/middleware/oAuth2Authenticate.ts

Reads the raw `Authorization` header and uses it unchanged as the `accessToken` lookup key, so a `Bearer ` prefix would make the lookup miss. Failure responses differ: an unknown token or a user without an account gives 404 'Invalid token.', while a null or expired `accessExpiresAt` gives 401, and a missing scope bit gives 401 'Scope not allowed.'. On success it sets `req.oAuth2Grant` with the user and `account.email`; the route decides whether email is returned (oauth2CurrentUser checks the USER_EMAIL bit).
