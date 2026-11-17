---
id: server-server-go-2bfd4afc
type: file
character: single
title: "server/server.go"
anchors:
  - {"path":"server/server.go","symbols":["StartServer","validateSecrets","corsMiddleware","telemetryMiddleware"],"hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.407Z
edits: 2
---

# server/server.go

Route registration order is the contract: /health and dashboard.Register precede corsMiddleware (no CORS headers), the public routes follow it, router.Use(authMiddleware) is at line 123, and the per-route CheckPermission/AdminOnlyMiddleware is passed inline in each route call. validateSecrets (JWT_SECRET >= 32 bytes; `insecure-dev-` prefix on JWT_SECRET/API_KEY is fatal only in gin release mode) runs before Mongo; Redis is connected unconditionally. corsMiddleware answers OPTIONS with 204 before c.Next(), so preflights never reach auth, and CORS headers are only set when Origin is in ALLOWED_CORS. /signup needs API_KEY; /reports/ingest and /reports/groups need REPORTS_ENABLED (/report-keys/* do not); TUF routes and the bumper goroutine need TUF_ENABLED; /download is public on purpose because its handler decides per app. No test builds the real route table.
