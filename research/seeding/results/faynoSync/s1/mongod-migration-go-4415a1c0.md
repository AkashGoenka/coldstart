---
id: mongod-migration-go-4415a1c0
type: file
character: single
title: "mongod/migration.go"
anchors:
  - {"path":"mongod/migration.go","symbols":["RunMigrationsUp","RunMigrationsDown","checkDuplicateAppVersions"],"hash":"sha256:47e1e4d559b9","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:25.564Z
edits: 2
---

# mongod/migration.go

`RunMigrationsUp` calls `checkDuplicateAppVersions` before `m.Up` on every run, including when nothing is pending. That check aggregates `apps` documents with an ObjectId `app_id` by (app_id, version, owner); if any group has more than one document it returns an error listing the document IDs before any migration applies, and its comment marks it REMOVE-IN v3.0.0. `RunMigrationsUp` treats `migrate.ErrNoChange` as success and then runs `backfillPrivateDownloads` and `backfillFeedArtifacts`, but a real migration error returns before them. `RunMigrationsDown` only calls `m.Down`. The migration files are embedded with `//go:embed migrations/*.json`, so no Go code registers a new migration.
