---
id: server-tuf-bootstrap-bootstrap-go-716f28d8
type: file
character: single
title: "server/tuf/bootstrap/bootstrap.go"
anchors:
  - {"path":"server/tuf/bootstrap/bootstrap.go","symbols":["PostBootstrap","GetBootstrapStatus","preLockBootstrap","bootstrapFinalizeWithContext","releaseBootstrapLock"],"hash":"sha256:3fcd0d3eecaa","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.596Z
edits: 1
---

# server/tuf/bootstrap/bootstrap.go

Per-app bootstrap state is the Redis string BOOTSTRAP_<admin>_<app>: preLockBootstrap writes pre-<taskID> with SetNX before the goroutine starts, and bootstrapFinalizeWithContext overwrites it with the bare taskID once BootstrapOnlineRolesWithContext succeeds; the rest of the code treats a leading pre- as in progress. PostBootstrap returns 409 when root.json already exists in S3 (hasPersistedRootMetadata), and GET /tuf/v1/bootstrap reports bootstrap as done on that same S3 check, so losing the Redis key alone does not allow a second bootstrap. On failure releaseBootstrapLock deletes the BOOTSTRAP key only if it still holds this task's pre- or bare id, and also removes pre-<task> and bootstrap:settings:<task>. The POST timeout (default 300 seconds) is used uncapped on this path, while recovery caps its own timeout at maxBootstrapTimeout (5 minutes).
