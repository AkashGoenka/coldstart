---
id: how-faynosync-is-put-together
type: flow
title: "how faynoSync is put together"
anchors:
  - {"path":"faynoSync.go","hash":"sha256:8860566197bd","head":"ca2f88a4fe38"}
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/auth.go","hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/handler.go","hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest.go","hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/handler/download/download.go","hash":"sha256:2c120c73a9df","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/tuf.go","hash":"sha256:091416c6c32c","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/ingest.go","hash":"sha256:8d4071ea3a02","head":"ca2f88a4fe38"}
  - {"path":"mongod/structs.go","hash":"sha256:5cfee343b008","head":"ca2f88a4fe38"}
  - {"path":"server/dashboard/dashboard.go","hash":"sha256:bc9c398a61d1","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.382Z
edits: 1
---

# how faynoSync is put together

faynoSync is one Go binary (gin API) that stores app versions in MongoDB and artifacts in object storage, and answers updater clients (squirrel, electron-builder, tauri, sparkle, velopack) with the latest version; Redis is required for caching, stats, rate limits and TUF locks. Subsystems: authenticated management API, public update-check routes, private downloads, optional TUF metadata signing (TUF_ENABLED), optional crash reports (REPORTS_ENABLED), telemetry stats, and an embedded React dashboard. The binary has three modes (server, healthcheck, migrate) and route registration order in server/server.go decides what is public.

## Steps

1. `faynoSync.go` (`main`) — mode dispatch: server, healthcheck, migrate up|down
2. `server/server.go` (`StartServer`) — boots deps and owns the route table; ordering decides which routes are public/CORS'd; starts the TUF bumper
3. `server/utils/auth.go` (`AuthMiddleware`) — session JWT or fns_ token to principal; authorization via permissions.go and owner.go
4. `server/handler/handler.go` (`appHandler`) — thin delegation to server/handler/* packages; reloads telemetry allow-list after mutations
5. `server/handler/info/latest.go` (`FindLatestVersion`) — update check with Redis/CDN response caching, per-updater shaping in server/utils/updaters
6. `server/handler/create/upload.go` (`UploadApp`) — multipart upload; presigned path in presigned.go; both finish in finalize.go (invalidation, feed materialization)
7. `server/handler/download/download.go` (`DownloadArtifact`) — private downloads authorized inside the handler
8. `server/tuf/tuf.go` (`SetupRoutes`) — TUF routes; bumper in server/tuf/metadata/online_bump.go
9. `server/handler/report/ingest.go` (`IngestReport`) — crash report ingest by report key
10. `mongod/structs.go` (`AppRepository`) — Mongo repository interface; migrations in mongod/migration.go run only via the migrate subcommand
11. `server/dashboard/dashboard.go` (`Register`) — embedded dashboard at /dashboard/

## Invariants

- Route registration order in server/server.go is the middleware contract
- Migrations never run on server start
