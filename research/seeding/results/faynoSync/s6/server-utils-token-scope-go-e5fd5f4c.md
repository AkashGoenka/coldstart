---
id: server-utils-token-scope-go-e5fd5f4c
type: file
character: single
title: "server/utils/token_scope.go"
anchors:
  - {"path":"server/utils/token_scope.go","symbols":["ValidateAPITokenAppScope","IsAPITokenRequest"],"hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.424Z
edits: 2
---

# server/utils/token_scope.go

ValidateAPITokenAppScope is a no-op for non-fns_ requests; for fns_ requests it fails closed on empty allowed_apps, resolves app_name+owner to an id in apps_meta and compares it with allowed_apps. It is called only from GetAppByName (/search), ResolveUploadRequest (/upload and /upload/init) and CompletePresignedUpload (re-checked against the stored pending app); the list handlers (/app/list, /channel/list) do not call it, so an fns_ token lists all its owner's apps. TestSearch_APITokenOutsideAllowedApps_Forbidden pins the /search case.
