---
id: mongod-migration-go-4415a1c0
type: file
character: single
title: "mongod/migration.go"
anchors:
  - {"path":"mongod/migration.go","symbols":["RunMigrationsUp","RunMigrationsDown","checkDuplicateAppVersions"],"hash":"sha256:47e1e4d559b9","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.534Z
edits: 2
---

# mongod/migration.go

RunMigrationsUp runs checkDuplicateAppVersions first (aborts before any migration if two apps docs share (app_id, version, owner)), then golang-migrate, then the Go backfills, which also run when m.Up returns ErrNoChange. RunMigrationsDown calls m.Down() for all versions and runs no backfill. Migrations are JSON command documents (createIndexes/dropIndexes) embedded with go:embed, not Go code. Only faynoSync.go calls these; the server never migrates on boot.
