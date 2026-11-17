---
id: how-migrate-up-down-runs-and-why-server-boot-never-migrates
type: flow
title: "how migrate up/down runs and why server boot never migrates"
anchors:
  - {"path":"faynoSync.go","hash":"sha256:8860566197bd","head":"ca2f88a4fe38"}
  - {"path":"mongod/migration.go","hash":"sha256:47e1e4d559b9","head":"ca2f88a4fe38"}
  - {"path":"mongod/private_download_backfill.go","hash":"sha256:7a80030ae05d","head":"ca2f88a4fe38"}
  - {"path":"mongod/feed_artifact_backfill.go","hash":"sha256:b13cab0c6817","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.375Z
edits: 1
---

# how migrate up/down runs and why server boot never migrates

Migrations run only from the `migrate up|down` subcommand, never at server start, and every `migrate up` re-runs two Go backfills after golang-migrate even when nothing is pending; `migrate down` calls m.Down() (all versions) and does not undo the backfills.

## Steps

1. `faynoSync.go` (`main`) — only caller of RunMigrationsUp/Down
2. `mongod/migration.go` (`RunMigrationsUp`, `RunMigrationsDown`, `checkDuplicateAppVersions`) — pre-check aborts up if duplicate (app_id, version, owner) exist; JSON command migrations embedded with go:embed
3. `mongod/private_download_backfill.go` (`backfillPrivateDownloads`, `backfillArtifactS3Keys`) — sets download_mode and s3_key; sets cdn_edge false on all private apps
4. `mongod/feed_artifact_backfill.go` (`backfillFeedArtifacts`) — sets is_feed true only

## Invariants

- Both backfills must stay idempotent (missing-field filters)
- Both are marked REMOVE-IN v3.0.0
