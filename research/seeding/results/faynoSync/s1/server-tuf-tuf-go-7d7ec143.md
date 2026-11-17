---
id: server-tuf-tuf-go-7d7ec143
type: file
character: single
title: "server/tuf/tuf.go"
anchors:
  - {"path":"server/tuf/tuf.go","symbols":["SetupRoutes"],"hash":"sha256:091416c6c32c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.625Z
edits: 1
---

# server/tuf/tuf.go

Bootstrap, config and metadata routes are all admin-only (AdminOnlyMiddleware), including the GET metadata/root, targets and delegated reads. Publish, delete and the GET /tuf/v1/task poll use CheckPermission(PermissionEdit, ResourceApps) plus ResolveOwnerMiddleware, so polling a task needs the same app-edit permission as starting one. SetupRoutes does not check TUF_ENABLED; server.go wraps this call and the online bumper together behind that flag.
