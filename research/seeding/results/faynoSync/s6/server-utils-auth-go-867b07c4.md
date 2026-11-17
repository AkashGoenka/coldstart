---
id: server-utils-auth-go-867b07c4
type: file
character: single
title: "server/utils/auth.go"
anchors:
  - {"path":"server/utils/auth.go","symbols":["AuthMiddleware","IsAPIToken"],"hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.411Z
edits: 2
---

# server/utils/auth.go

AuthMiddleware returns immediately if a principal is already in context, so the extra `authMiddleware` arguments on /user/*, /token/* and TUF routes are no-ops after the global router.Use. A token that parses as a session JWT never reaches the API-token branch; a non-revoked-session verify error (DB error, 5s timeout) is a 500 not 401. Only `fns_`-prefixed Bearer values are tried as API tokens (sha256 lookup in api_tokens, 401 if missing or expired), and the request then gets an admin-type principal with is_api_token and allowed_apps set, so code that checks only PrincipalAdmin treats it as admin unless it also checks is_api_token. `fnd_` download tokens sent as Bearer get 401 here.
