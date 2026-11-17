---
id: src-middleware-oauth2authenticate-ts-98e7bbc3
type: file
character: single
title: "src/middleware/oAuth2Authenticate.ts"
anchors:
  - {"path":"src/middleware/oAuth2Authenticate.ts","symbols":["oAuth2Authenticate"],"hash":"sha256:b58635db5e81","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.832Z
edits: 2
---

# src/middleware/oAuth2Authenticate.ts

OAuth2 requests bypass the user path entirely: a direct Prisma lookup of applicationUserGrant by the raw Authorization value on every request, with no Redis user cache, no authenticateUser, no suspension, IP-ban or bot check. Unknown token or a grant whose user has no account is 404 'Invalid token.', while a missing or expired accessExpiresAt or a missing scope bit is 401. Scope is enforced only when the route passes scopes; the only route found using it is oauth2CurrentUser with USER_INFO.
