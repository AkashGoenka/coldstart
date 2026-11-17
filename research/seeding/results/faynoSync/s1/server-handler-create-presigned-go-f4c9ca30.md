---
id: server-handler-create-presigned-go-f4c9ca30
type: file
character: single
title: "server/handler/create/presigned.go"
anchors:
  - {"path":"server/handler/create/presigned.go","symbols":["InitPresignedUpload","CompletePresignedUpload","parsePresignedManifest","pendingUpload"],"hash":"sha256:c308d015011f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:25.221Z
edits: 1
---

# server/handler/create/presigned.go

Holds the whole presigned state machine. InitPresignedUpload stores a pendingUpload whose expires_at is the PRESIGNED_UPLOAD_URL_TTL (default 30m, rejected above 7d and then reset to 30m) plus a 90 min grace, and CompletePresignedUpload claims it by flipping state pending to completing. The manifest requires only md5; sha256 and sha512 are syntax-checked and stored as unverified declared hashes, and length 0 means the stored size is taken from StatObject at complete. A failure before any write sets the state back to pending, but once repository.Upload has stored one version (len(results) > 0) the release is skipped, so the record stays completing and later completes return 404. Storage drivers that do not implement PresignedUploader get 501 at init.
