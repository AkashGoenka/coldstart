---
id: server-tuf-artifacts-add-go-3e589650
type: file
character: single
title: "server/tuf/artifacts/add.go"
anchors:
  - {"path":"server/tuf/artifacts/add.go","symbols":["AddArtifacts","addArtifactsLocked"],"hash":"sha256:953272468040","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.617Z
edits: 1
---

# server/tuf/artifacts/add.go

AddArtifacts refuses only when BOOTSTRAP_<admin>_<app> is missing or empty, so a pre-<taskID> value passes here, although GET /tuf/v1/bootstrap and the online bumper treat that value as not completed. The work runs in addArtifactsLocked inside WithSnapshotLock: it loads the trusted root through LoadAnchoredRoot, downloads the latest targets file from S3, and maps each artifact to a role with getRoleForArtifactPath. Paths that map to no role are logged and skipped, and if none remain the call fails with 'no valid artifacts to add'. Targets expiry comes from Redis TARGETS_EXPIRATION_<admin>_<app>, with 365 as the fallback argument.
