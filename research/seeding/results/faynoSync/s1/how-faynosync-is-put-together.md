---
id: how-faynosync-is-put-together
type: flow
title: "how faynoSync is put together"
anchors:
  - {"path":"faynoSync.go","hash":"sha256:8860566197bd","head":"ca2f88a4fe38"}
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/dashboard/dashboard.go","hash":"sha256:bc9c398a61d1","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/handler/handler.go","hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:20:03.275Z
edits: 1
---

# how faynoSync is put together

Everything is registered in one place, server.StartServer, and ORDER of registration is the access policy: gin's router.Use(authMiddleware) only covers routes declared after it, so /health, /dashboard, /update/.../RELEASES, /velopack, /checkVersion, /apps/latest, /telemetry/beacon, /signup, /login, /reports/ingest and /download are declared before it and are not behind the JWT/API-token gate (private-app and report-key checks happen inside those handlers). Redis is mandatory at boot (no optional path), Mongo holds all data, and files live in S3-compatible storage chosen by STORAGE_DRIVER; PERFORMANCE_MODE only toggles the Redis response cache for /checkVersion. Several route groups are conditional on env: /signup needs API_KEY, /reports/* needs REPORTS_ENABLED, /tuf/v1/* plus the online-roles bumper goroutine need TUF_ENABLED, the dashboard is on unless DASHBOARD_ENABLED=false. The same binary also runs `migrate up|down` (JSON migrations embedded from mongod/migrations) and `healthcheck`, selected by the first CLI arg in faynoSync.go; the React dashboard is built by vite into server/dashboard/ui/dist and go:embed'ed, so an unbuilt dashboard makes /dashboard/ return 503.

## Steps

1. `faynoSync.go` (`main`) — loads .env via viper (falls back to system env), then dispatches no-arg to StartServer, or healthcheck, or migrate up/down
2. `server/server.go` (`StartServer`, `validateSecrets`, `corsMiddleware`) — validates secrets, connects Mongo and Redis, builds the handler, registers every route in the order that defines which are authenticated
3. `server/handler/handler.go` (`NewAppHandler`, `AppHandler`) — adapter that binds gin handlers from server/handler/* subpackages to the repository, mongo DB, redis client and performanceMode
4. `server/utils/permissions.go` (`CheckPermission`) — per-route permission middleware wrapped around write routes
5. `server/dashboard/dashboard.go` (`Register`) — serves the embedded SPA under /dashboard

## Invariants

- a route declared before router.Use(authMiddleware) in StartServer is public at the middleware level; any auth for it must be inside the handler
- Redis must be reachable at startup
