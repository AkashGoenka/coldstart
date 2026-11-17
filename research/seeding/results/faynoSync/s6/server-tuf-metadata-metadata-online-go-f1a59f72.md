---
id: server-tuf-metadata-metadata-online-go-f1a59f72
type: file
character: single
title: "server/tuf/metadata/metadata_online.go"
anchors:
  - {"path":"server/tuf/metadata/metadata_online.go","symbols":["PostMetadataOnline","forceOnlineMetadataUpdateLocked","bumpDelegatedRoles","buildOnlineRoleSigners"],"hash":"sha256:6b4681705fc5","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.493Z
edits: 2
---

# server/tuf/metadata/metadata_online.go

POST /tuf/v1/metadata/online returns 202 with a task_id before any work (goroutine on context.Background). Default roles are snapshot+timestamp, plus targets only if TARGETS_ONLINE_KEY_<admin>_<app> is true; requesting root is 400, targets while offline is 404. Its bootstrap gate rejects only an absent/empty BOOTSTRAP value, so pre-/signing- values pass (PostMetadataRotate's gate is stricter). bumpDelegatedRoles skips a delegation whose latest file cannot be loaded (warn, task still SUCCESS) but fails the whole update on a delegation that does not verify; it does not bump targets. Expiry defaults come from Redis <ROLE>_EXPIRATION_ keys: targets and delegated 365 days here, snapshot 7, timestamp 1.
