---
id: server-handler-handler-go-4e84ae0a
type: file
character: single
title: "server/handler/handler.go"
anchors:
  - {"path":"server/handler/handler.go","symbols":["AppHandler","appHandler","reloadTelemetryAllowListAfterSuccess","NewAppHandler"],"hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.428Z
edits: 2
---

# server/handler/handler.go

AppHandler is an interface listing every route method; a new method goes in both the interface and the appHandler struct. The telemetry allow-list reload lives here, not in subpackages: 17 mutating methods call reloadTelemetryAllowListAfterSuccess, which runs synchronously with a 30s timeout only when the response status is 200-399 and logs (does not fail) on error; user, token, report-group and download-token writes do not reload. NewAppHandler does the first load. Team-user and token methods pass ch.database; most others pass ch.repository.
