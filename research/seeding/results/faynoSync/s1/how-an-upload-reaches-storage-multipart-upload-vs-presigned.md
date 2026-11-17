---
id: how-an-upload-reaches-storage-multipart-upload-vs-presigned
type: flow
title: "how an upload reaches storage: multipart /upload vs presigned /upload/init and /upload/complete"
anchors:
  - {"path":"server/handler/create/request.go","hash":"sha256:a14f7239f164","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/presigned.go","hash":"sha256:c308d015011f","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/finalize.go","hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
  - {"path":"server/utils/s3.go","hash":"sha256:5c1a3ac371b6","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:25.214Z
edits: 1
---

# how an upload reaches storage: multipart /upload vs presigned /upload/init and /upload/complete

Both paths validate in ResolveUploadRequest and PlanUploadPlacements before any version row is written, and both finish in FinalizeUpload; the difference is that a presigned upload never writes the final key until CompletePresignedUpload copies the client-PUT bytes from a pending/<upload_id>/<index> staging object. Init stores a pending_uploads document that Complete claims by flipping its state from pending to completing, and the Mongo TTL index on expires_at removes stale ones. The visibility fixed at init chooses the bucket and ACL, and Complete returns 409 if app visibility changed since then.

## Steps

1. `server/handler/create/request.go` (`ResolveUploadRequest`) — authenticates, resolves the admin owner, runs ValidateParams, checks API-token app scope and team-user access; used by UploadApp and InitPresignedUpload but not by Complete
2. `server/handler/create/upload.go` (`UploadApp`) — multipart path: plans placements (conflicts reported before any write), then per file hashes it, UploadToS3 writes the object, repository.Upload records the version; FinalizeUpload runs once after the loop
3. `server/handler/create/presigned.go` (`InitPresignedUpload`) — presign path start: stages inline feed files to pending keys, returns a signed PUT per manifest file, inserts the pendingUpload record with expires_at = PUT TTL + 90 min grace
4. `server/handler/create/presigned.go` (`CompletePresignedUpload`) — claims the record, StatObject-verifies each non-inline file (size and MD5), CopyObject pending key to final key, repository.Upload per file, FinalizeUpload, then deletes staged objects and the record
5. `server/handler/create/finalize.go` (`FinalizeUpload`) — shared tail of both paths: publish-gated cache invalidation, then velopack or sparkle feed materialization for the uploaded tuple only
6. `server/utils/s3.go` (`BuildObjectPlacement`) — picks bucket from visibility (logo or public app goes to S3_BUCKET_NAME, private goes to S3_BUCKET_NAME_PRIVATE) and the storage key; UploadToS3 writes through it

## Invariants

- Complete claims the record with one FindOneAndUpdate filtered on state pending, the same username and principal, and expires_at greater than now, so a second complete for the same upload_id gets 404.
- Presigned files keep client-declared sha256 and sha512 with hashes_verified=false (fileCtxQuery in CompletePresignedUpload); only inline feed files are marked verified. The code comment defers checking those hashes to TUF publish.
- Visibility is fixed at init: CompletePresignedUpload compares checkAppVisibility with pending.Private and returns 409 on a mismatch, and pending.Public decides both the bucket and the CopyObject ACL.
- Non-inline presigned bytes never pass through faynoSync: the client PUTs to the staging key, and only the server-side CopyObject moves them to the final key.
