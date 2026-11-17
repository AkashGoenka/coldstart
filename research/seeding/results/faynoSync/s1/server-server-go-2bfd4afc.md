---
id: server-server-go-2bfd4afc
type: file
character: hub
title: "server/server.go"
anchors:
  - {"path":"server/server.go","symbols":["telemetryMiddleware"],"hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.666Z
edits: 1
---

# server/server.go

## Facets

- **telemetryMiddleware** — Telemetry routes are gated per route, not with router.Use: GET /telemetry/beacon is declared before authMiddleware (public) and GET /telemetry after it (authMiddleware, then telemetryMiddleware). When ENABLE_TELEMETRY is false, telemetryMiddleware answers 403 JSON on both. /checkVersion is not behind this middleware; its telemetry is gated only inside logStatsToRedis.
