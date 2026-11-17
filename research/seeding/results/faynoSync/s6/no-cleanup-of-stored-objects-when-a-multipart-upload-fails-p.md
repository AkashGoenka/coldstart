---
id: no-cleanup-of-stored-objects-when-a-multipart-upload-fails-p
type: lesson
kind: absence
title: "no cleanup of stored objects when a multipart upload fails partway"
scope: {"terms":["UploadApp","DeleteObject","DeleteFromS3"]}
status: active
updated: 2026-11-17T03:28:54.558Z
edits: 1
---

# no cleanup of stored objects when a multipart upload fails partway

UploadApp has no delete on its failure paths; the only deletes in the create handlers are staged-object cleanup after a successful presigned complete and the CDN sweep. Objects stored for earlier files stay when a later file fails.

## Scope (absence — freshness = re-run this search)

- terms: `UploadApp`, `DeleteObject`, `DeleteFromS3`
