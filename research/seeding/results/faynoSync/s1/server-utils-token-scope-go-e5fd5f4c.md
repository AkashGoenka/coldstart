---
id: server-utils-token-scope-go-e5fd5f4c
type: file
character: single
title: "server/utils/token_scope.go"
anchors:
  - {"path":"server/utils/token_scope.go","symbols":["ValidateAPITokenAppScope"],"hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.143Z
edits: 4
---

# server/utils/token_scope.go

ValidateAPITokenAppScope does nothing unless the request carries is_api_token; then it requires a non-empty allowed_apps and that the app's apps_meta _id, found by app_name and owner, is in that list. The two refusals have different messages: a missing apps_meta row returns 'app_name not found ... or you don't have permission', an unlisted app returns 'api token has no access to this app'. Callers are the upload request path (server/handler/create/request.go), presigned upload (server/handler/create/presigned.go) and GET /search (server/handler/catalog/get.go).
