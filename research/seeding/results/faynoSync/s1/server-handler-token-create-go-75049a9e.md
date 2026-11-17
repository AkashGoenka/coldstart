---
id: server-handler-token-create-go-75049a9e
type: file
character: single
title: "server/handler/token/create.go"
anchors:
  - {"path":"server/handler/token/create.go","symbols":["CreateToken","validateAllowedApps"],"hash":"sha256:6254f308d46e","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:47.931Z
edits: 3
---

# server/handler/token/create.go

CreateToken takes the owner from the username in the context and is registered behind AdminOnlyMiddleware, so an API token cannot mint another token. validateAllowedApps requires every allowed_apps id to be an apps_meta document whose owner is that username and whose app_name exists, and any mismatch fails the whole request. The stored document keeps only token_hash and token_prefix.
