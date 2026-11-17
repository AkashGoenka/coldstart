---
id: server-utils-auth-go-867b07c4
type: file
character: single
title: "server/utils/auth.go"
anchors:
  - {"path":"server/utils/auth.go","symbols":["AuthMiddleware"],"hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.132Z
edits: 4
---

# server/utils/auth.go

AuthMiddleware returns early when a principal is already on the request context, so routes that list it explicitly and also sit behind router.Use(authMiddleware) verify once. A Bearer value is first parsed as a session JWT; if that fails with a token-level error and the value is an fns_ token, it is looked up in api_tokens by hash, last_used_at is written on every use (a failed write is logged and the request continues), and the request gets an admin principal named after the token owner plus is_api_token and allowed_apps. Claims-level JWT errors return 401 before any database read.
