---
id: how-an-upload-is-stored-and-published-multipart-and-presigne
type: flow
title: "how an upload is stored and published (multipart and presigned)"
anchors:
  - {"path":"server/handler/create/request.go","hash":"sha256:a14f7239f164","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/presigned.go","hash":"sha256:c308d015011f","head":"ca2f88a4fe38"}
  - {"path":"server/utils/storage/interfaces.go","hash":"sha256:11164fb07e83","head":"ca2f88a4fe38"}
  - {"path":"mongod/create.go","hash":"sha256:317006604766","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/finalize.go","hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
  - {"path":"server/utils/s3.go","hash":"sha256:5c1a3ac371b6","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.361Z
edits: 1
---

# how an upload is stored and published (multipart and presigned)

Presigned upload is two requests: init writes a pending_uploads record and returns PUT URLs under pending/<id>/<index>; complete claims the record, verifies each staged object's size and MD5, CopyObjects it to its final key and only then writes the DB, so the DB only sees objects that already exist. Multipart UploadApp instead stores all files first and then calls repository.Upload once per file, with no cleanup of stored objects if a later call fails. Both paths end in FinalizeUpload, which runs cache invalidation (only if the publish form field is true/false) and feed materialization.

## Steps

1. `server/handler/create/request.go` (`ResolveUploadRequest`) — shared parse: username, owner, params, app_name, ValidateAPITokenAppScope, EnsureTeamUserUploadAccess, all before any storage call
2. `server/handler/create/upload.go` (`UploadApp`, `PlanUploadPlacements`) — multipart path; placement conflicts return 400/409 before any S3 write
3. `server/handler/create/presigned.go` (`InitPresignedUpload`, `CompletePresignedUpload`) — pending record + atomic claim; state 'completing' sticks if a later file fails
4. `server/utils/storage/interfaces.go` (`PresignedUploader`) — optional interface; minio does not implement it
5. `mongod/create.go` (`Upload`) — insert or append one artifact per call
6. `server/handler/create/finalize.go` (`FinalizeUpload`) — invalidation then feed materialization

## Invariants

- A second complete on the same id gets 404
- Staged object and pending-record cleanup happens after FinalizeUpload and its errors are only logged
- Feed files (releases.*.json, appcast*.xml) cannot be presigned
