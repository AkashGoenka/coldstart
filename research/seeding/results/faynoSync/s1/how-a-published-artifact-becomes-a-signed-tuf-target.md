---
id: how-a-published-artifact-becomes-a-signed-tuf-target
type: flow
title: "how a published artifact becomes a signed TUF target"
anchors:
  - {"path":"server/tuf/tuf.go","hash":"sha256:091416c6c32c","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/artifacts/handlers.go","hash":"sha256:f448e9880fa3","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/artifacts/converter.go","hash":"sha256:6b1dbf80e6eb","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/artifacts/add.go","hash":"sha256:953272468040","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/metadata/locking.go","hash":"sha256:c8092da1745d","head":"ca2f88a4fe38"}
  - {"path":"server/tuf/tasks/task.go","hash":"sha256:c2de38c5ba2e","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.578Z
edits: 1
---

# how a published artifact becomes a signed TUF target

Publish is asynchronous and its result is stored in two places: POST /tuf/v1/artifacts/publish answers 202 before any signing starts, and only the Redis task:<id> record plus artifacts.$.tuf_signed in Mongo show whether AddArtifacts succeeded. The targets file is read from S3 (not Redis or Mongo), and AddArtifacts runs under the Redis lock LOCK_SNAPSHOT_<admin>_<app>, the same lock the online-roles bumper takes before it re-signs.

## Steps

1. `server/tuf/tuf.go` (`SetupRoutes`) — POST /tuf/v1/artifacts/publish sits behind the app-edit permission and owner resolution, then calls artifacts.PostPublishArtifacts
2. `server/tuf/artifacts/handlers.go` (`PostPublishArtifacts`, `selectSignableArtifacts`) — drops IsFeed artifacts and ones already tuf_signed, converts the rest, writes task PENDING then STARTED then RUNNING, returns 202, and starts the signing goroutine
3. `server/tuf/artifacts/converter.go` (`ConvertMongoArtifactToTUF`) — derives the TUF target path from the artifact link and rejects artifacts that have no hashes or no length
4. `server/tuf/artifacts/add.go` (`AddArtifacts`, `addArtifactsLocked`) — checks the BOOTSTRAP_ key is non-empty, takes the snapshot lock, loads the trusted root and the latest targets from S3, and routes each artifact path to a role
5. `server/tuf/metadata/locking.go` (`WithSnapshotLock`) — holds LOCK_SNAPSHOT_<admin>_<app> around the callback, renewing its lease while the callback runs
6. `server/tuf/tasks/task.go` (`SaveTaskStatus`, `GetTask`) — stores the task state that GET /tuf/v1/task reads back for pollers

## Invariants

- PostPublishArtifacts is the only caller of AddArtifacts, and selectSignableArtifacts drops feed artifacts before conversion, so feeds never become TUF targets on the publish path
- tuf_signed is written only after AddArtifacts returns; on failure the converted artifacts are set to tuf_signed=false and unconverted ones are not touched
- A publish with no unsigned non-feed artifacts returns 200 with no task_id and starts no task
- GET /tuf/v1/task answers PENDING for a missing key, so an expired or unknown task id looks the same as one not yet written
- AddArtifacts refuses only a missing or empty BOOTSTRAP_ value; a pre-<taskID> value passes that check
