---
id: server-handler-create-request-go-9eb79ac1
type: file
character: single
title: "server/handler/create/request.go"
anchors:
  - {"path":"server/handler/create/request.go","symbols":["ResolveUploadRequest","ResolveAppVisibility"],"hash":"sha256:a14f7239f164","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.456Z
edits: 2
---

# server/handler/create/request.go

ResolveUploadRequest is the shared parser for /upload and /upload/init and fixes the check order: username, ResolveRequestOwner, ValidateParams, optional intermediate, app_name, ValidateAPITokenAppScope (403), EnsureTeamUserUploadAccess; all rejections happen before any storage call. ResolveAppVisibility 404s for unknown apps and rejects updaters that need a public feed on private apps.
