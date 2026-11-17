---
id: how-the-dashboard-is-built-into-the-go-binary-and-served-at
type: flow
title: "how the dashboard is built into the Go binary and served at /dashboard/"
anchors:
  - {"path":"dashboard/vite.config.ts","hash":"sha256:1b90d4f459fe","head":"ca2f88a4fe38"}
  - {"path":"Dockerfile","hash":"sha256:c2e175d549ba","head":"ca2f88a4fe38"}
  - {"path":"server/dashboard/dashboard.go","hash":"sha256:bc9c398a61d1","head":"ca2f88a4fe38"}
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.379Z
edits: 1
---

# how the dashboard is built into the Go binary and served at /dashboard/

The dashboard is compiled into the binary at go build time: vite writes to server/dashboard/ui/dist (emptyOutDir true) and dashboard.go embeds ui with go:embed; a go build without a prior dashboard build still compiles but /dashboard/ answers 503.

## Steps

1. `dashboard/vite.config.ts` (`defineConfig`) — base /dashboard/, outDir ../server/dashboard/ui/dist
2. `Dockerfile` — ui stage runs yarn build; golang stage copies output into server/dashboard/ui/dist before go build
3. `server/dashboard/dashboard.go` (`Register`, `serve`) — embedded sub-FS, SPA fallback, config.json generated
4. `server/server.go` (`StartServer`) — Register only when DASHBOARD_ENABLED (default true), before CORS and auth

## Invariants

- BasePath /dashboard/ is hardcoded in both vite.config.ts and dashboard.go
- The CSP string in dashboard.go must match the contentSecurityPolicy in vite.config.ts
