---
id: server-handler-handler-go-4e84ae0a
type: file
character: hub
title: "server/handler/handler.go"
anchors:
  - {"path":"server/handler/handler.go","symbols":["reloadTelemetryAllowListAfterSuccess"],"hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.654Z
edits: 1
---

# server/handler/handler.go

## Facets

- **reloadTelemetryAllowListAfterSuccess** — The allow-list is rebuilt only when the wrapped handler left a 2xx or 3xx status, and only after channel, platform, architecture, app, app-version, artifact and update writes (the calls listed around lines 139-246). The rebuild runs on context.Background with a 30 second timeout, not the request context, so a client disconnect does not cancel it. A failed rebuild is logged and the previous list stays in place.
