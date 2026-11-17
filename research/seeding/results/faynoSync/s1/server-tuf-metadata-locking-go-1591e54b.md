---
id: server-tuf-metadata-locking-go-1591e54b
type: file
character: single
title: "server/tuf/metadata/locking.go"
anchors:
  - {"path":"server/tuf/metadata/locking.go","symbols":["WithSnapshotLock","snapshotLockKey"],"hash":"sha256:c8092da1745d","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.621Z
edits: 1
---

# server/tuf/metadata/locking.go

The snapshot lock is the Redis key LOCK_SNAPSHOT_<admin>_<app>, taken with SetNX and a random token, with a 300-second TTL that is renewed every 100 seconds while the callback runs; acquisition retries with backoff for up to 500 seconds. Renewal and release are token-guarded Lua scripts, so a holder whose lease expired cannot extend or delete another holder's lock. Callers are AddArtifacts, RemoveArtifacts, forceOnlineMetadataUpdate (the online bumper's path) and two sites in metadata_utils.go, so these operations serialize per app.
