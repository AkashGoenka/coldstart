---
id: server-tuf-bootstrap-bootstrap-go-716f28d8
type: file
character: single
title: "server/tuf/bootstrap/bootstrap.go"
anchors:
  - {"path":"server/tuf/bootstrap/bootstrap.go","symbols":["PostBootstrap","preLockBootstrap","releaseBootstrapLock","GetBootstrapStatus"],"hash":"sha256:3fcd0d3eecaa","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.499Z
edits: 2
---

# server/tuf/bootstrap/bootstrap.go

Bootstrap state is the single Redis key BOOTSTRAP_<admin>_<app>: PostBootstrap claims it with SETNX to pre-<taskID> (no TTL), and a successful finalize replaces it with the bare taskID, which marks the app complete. A stale pre- lock is cleared only when its task state is FAILURE/ERRORED/REVOKED/PENDING and neither the pre-lock nor bootstrap:settings keys exist. PostBootstrap 409s if root metadata already exists in storage; ValidateExpiration limits (root 365, targets 180, snapshot 30, timestamp 7 days) apply only to those four roles, and the 300s default timeout has no upper bound on this path (only recovery caps it). GetBootstrapStatus reports completed if a root file exists or BOOTSTRAP is non-empty without the pre- prefix.
