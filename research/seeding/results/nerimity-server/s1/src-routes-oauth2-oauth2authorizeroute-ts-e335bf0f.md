---
id: src-routes-oauth2-oauth2authorizeroute-ts-e335bf0f
type: file
character: single
title: "src/routes/oauth2/oauth2AuthorizeRoute.ts"
anchors:
  - {"path":"src/routes/oauth2/oauth2AuthorizeRoute.ts","symbols":["oauth2AuthorizeRoute","route"],"hash":"sha256:2c9f3218b1dc","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.494Z
edits: 1
---

# src/routes/oauth2/oauth2AuthorizeRoute.ts

POST /oauth2/authorize needs a logged-in user (`authenticate()`) and reads clientId, redirectUri and scopes from the query string; scopes are split on single spaces. The redirectUri validator caps length at 20 characters, so a longer URI is rejected here before the service's exact-match check. The user id passed to oauth2Authorize is req.userCache.id.
