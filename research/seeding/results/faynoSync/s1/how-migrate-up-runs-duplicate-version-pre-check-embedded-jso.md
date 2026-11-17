---
id: how-migrate-up-runs-duplicate-version-pre-check-embedded-jso
type: flow
title: "how migrate up runs: duplicate-version pre-check, embedded JSON migrations, then backfills"
anchors:
  - {"path":"faynoSync.go","hash":"sha256:8860566197bd","head":"ca2f88a4fe38"}
  - {"path":"mongod/migration.go","hash":"sha256:47e1e4d559b9","head":"ca2f88a4fe38"}
  - {"path":"mongod/migrations/20260923140000_create_unique_app_version_index.up.json","hash":"sha256:e997d9d93eb1","head":"ca2f88a4fe38"}
  - {"path":"mongod/private_download_backfill.go","hash":"sha256:7a80030ae05d","head":"ca2f88a4fe38"}
  - {"path":"mongod/feed_artifact_backfill.go","hash":"sha256:b13cab0c6817","head":"ca2f88a4fe38"}
  - {"path":"mongod/create.go","hash":"sha256:317006604766","head":"ca2f88a4fe38"}
  - {"path":"faynoSync_test.go","hash":"sha256:09ae587d8d06","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:21.335Z
edits: 1
---

# how migrate up runs: duplicate-version pre-check, embedded JSON migrations, then backfills

`faynoSync migrate up` runs a duplicate-version check over `apps` before any migration file, so the check runs on every up, not only ahead of the unique-index migration. After the embedded JSON migrations apply (or report no change), two Go backfills run on every up; `migrate down` runs neither the check nor the backfills. The check exists so that the `unique_app_version_owner` index can be created, and the same index is the backstop for the upload path's find-or-append logic in create.go.

## Steps

1. `faynoSync.go` — the `migrate up|down` argument branch: connects with ConnectToDatabase and calls RunMigrationsUp or RunMigrationsDown
2. `mongod/migration.go` (`RunMigrationsUp`, `checkDuplicateAppVersions`) — runs the duplicate pre-check first, then m.Up, treats migrate.ErrNoChange as success, then runs the backfills
3. `mongod/migrations/20260923140000_create_unique_app_version_index.up.json` — creates unique_app_version_owner on apps over (app_id, version, owner), with a partialFilterExpression on app_id $type objectId
4. `mongod/private_download_backfill.go` (`backfillPrivateDownloads`) — runs after every up: backfills artifact s3_key values, then download_mode and cdn_edge on private apps_meta documents
5. `mongod/feed_artifact_backfill.go` (`backfillFeedArtifacts`) — runs after every up: sets is_feed true on pre-existing feed artifacts and never touches tuf_signed
6. `mongod/create.go` (`isVersionIndexDuplicate`) — the upload insert path that relies on the unique index: on the first conflict it loops and re-reads, then appends instead of failing

## Invariants

- The pre-check's grouping key (app_id, version, owner) and its $match on app_id $type objectId are the same as the unique index's key and partialFilterExpression.
- migrate down calls only m.Down: it runs neither checkDuplicateAppVersions nor the backfills, and the backfill Go code has no reverse step.
- The backfills are meant to be re-runnable: faynoSync_test.go calls RunMigrationsUp twice and asserts the s3_key count stays at 1 and the download_mode backfill holds.
