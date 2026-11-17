---
id: server-handler-create-presigned-go-f4c9ca30
type: file
character: single
title: "server/handler/create/presigned.go"
anchors:
  - {"path":"server/handler/create/presigned.go","symbols":["InitPresignedUpload","CompletePresignedUpload","verifyPresignedFile","pendingUpload"],"hash":"sha256:c308d015011f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.449Z
edits: 2
---

# server/handler/create/presigned.go

Complete claims the pending_uploads record with one FindOneAndUpdate (id, username, principal type/id, state pending, expires_at in future) setting state completing; any other complete gets 404. release() resets to pending only on failures before any artifact is written or on a failed first-file Upload; a failure on a later file leaves it completing and every retry 404s until the TTL index reaps the record (created_at + PUT TTL + 90 min). verifyPresignedFile rejects objects with no MD5 (multipart ETag) and uses the stored size; presigned non-inline artifacts are stored with hashes_verified=false and client-declared sha256/sha512 (TUF publish later verifies them). Complete re-runs ValidateAPITokenAppScope, EnsureTeamUserUploadAccess, findArtifactConflict, and 409s if the app's private flag changed since init. Feed files cannot be presigned (400); presigned size cap 5 GiB. Init returns 501 if the driver is not a PresignedUploader.
