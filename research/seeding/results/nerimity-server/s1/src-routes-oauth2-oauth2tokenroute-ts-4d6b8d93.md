---
id: src-routes-oauth2-oauth2tokenroute-ts-4d6b8d93
type: file
character: single
title: "src/routes/oauth2/oauth2TokenRoute.ts"
anchors:
  - {"path":"src/routes/oauth2/oauth2TokenRoute.ts","symbols":["oauth2TokenRoute","route"],"hash":"sha256:138debcc456e","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.497Z
edits: 1
---

# src/routes/oauth2/oauth2TokenRoute.ts

POST /oauth2/token reads every grant input from the query string. Validators cover only clientId, clientSecret and grantType; redirectUri and code are not validated by the route, and the authorization_code branch passes redirectUri straight into exchangeCodeForToken. Service errors are returned as HTTP 500, not 400.
