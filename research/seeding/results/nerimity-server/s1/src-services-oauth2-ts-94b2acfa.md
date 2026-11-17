---
id: src-services-oauth2-ts-94b2acfa
type: file
character: hub
title: "src/services/Oauth2.ts"
anchors:
  - {"path":"src/services/Oauth2.ts","symbols":["oauth2Authorize","exchangeCodeForToken","refreshToken","getOAuthApplication"],"hash":"sha256:666ed1f2a8bc","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.462Z
edits: 1
---

# src/services/Oauth2.ts

## Facets

- **oauth2Authorize** — Upserts one applicationUserGrant per (application, user), capped at 50 grants per user. The authorization code lives 3 minutes. Re-authorizing resets accessToken, accessExpiresAt, refreshToken and refreshExpiresAt to null, so tokens from the earlier grant no longer match. Any unknown scope name fails the whole request.
- **exchangeCodeForToken** — The client secret must equal application.clientSecret exactly. The grant lookup matches code, applicationId and redirectUri together. After use the code is nulled and codeExpiresAt is set to now. Access tokens last 1 day and refresh tokens 30 days; expiresIn is returned in seconds.
- **refreshToken** — Rotates both tokens on every call by overwriting accessToken and refreshToken on the grant, so the previous access token stops matching a row. The same client-secret check applies.
- **getOAuthApplication** — Backs the authorize GET. It requires a user with an account and an exact redirectUri match in application.redirectUris, and strips redirectUris from the result it returns.
