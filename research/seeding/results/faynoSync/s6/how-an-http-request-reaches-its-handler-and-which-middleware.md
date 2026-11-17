---
id: how-an-http-request-reaches-its-handler-and-which-middleware
type: flow
title: "how an HTTP request reaches its handler and which middleware it passes"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/auth.go","hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/handler/handler.go","hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
  - {"path":"server/utils/token_scope.go","hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
  - {"path":"server/handler/catalog/list.go","hash":"sha256:96ac91aefa7c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.343Z
edits: 1
---

# how an HTTP request reaches its handler and which middleware it passes

Route registration order in StartServer is the middleware contract: /health and dashboard.Register come before router.Use(corsMiddleware) (no CORS headers), the public routes follow it, and everything after router.Use(authMiddleware) needs a principal. Authentication is global, but authorization is opt-in per route: CheckPermission or AdminOnlyMiddleware is passed inline in the route call, and per-app scoping for fns_ tokens happens inside handlers.

## Steps

1. `server/server.go` (`StartServer`, `corsMiddleware`, `telemetryMiddleware`) — flat route table. Public (before authMiddleware): /checkVersion, /apps/latest, /update/.../RELEASES, /velopack/..., /telemetry/beacon, /login, /signup (only if API_KEY set), /reports/ingest (only if REPORTS_ENABLED), /download. /app/list, /channel/list, /platform/list, /arch/list and /search are authenticated but carry no CheckPermission. corsMiddleware answers any OPTIONS with 204 before the auth middleware runs
2. `server/utils/auth.go` (`AuthMiddleware`) — turns a Bearer session JWT or fns_ token into a principal; no-op if a principal is already set
3. `server/utils/permissions.go` (`CheckPermission`, `AdminOnlyMiddleware`) — per-route action gate
4. `server/handler/handler.go` (`appHandler`, `reloadTelemetryAllowListAfterSuccess`) — one-line delegation to server/handler/* subpackages; 17 mutating methods then reload the telemetry allow-list on 2xx/3xx
5. `server/utils/token_scope.go` (`ValidateAPITokenAppScope`) — per-app scope for fns_ tokens, called from handlers not middleware

## Invariants

- A route added above router.Use(authMiddleware) gets no auth
- /download is public at the router on purpose: the handler decides per app
- telemetryMiddleware gates both /telemetry/beacon (public) and /telemetry (authenticated) on ENABLE_TELEMETRY
