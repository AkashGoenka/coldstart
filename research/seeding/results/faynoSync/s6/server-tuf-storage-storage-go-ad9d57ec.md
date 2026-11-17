---
id: server-tuf-storage-storage-go-ad9d57ec
type: file
character: hub
title: "server/tuf/storage/storage.go"
anchors:
  - {"path":"server/tuf/storage/storage.go","symbols":["UploadMetadataToS3","FindLatestMetadataVersion","GetAllDelegatedRoles","ListMetadataFromS3"],"hash":"sha256:b4d51fed1c86","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.769Z
edits: 1
---

# server/tuf/storage/storage.go

## Facets

- **UploadMetadataToS3** — Only timestamp.json gets Cache-Control public, max-age=60, must-revalidate. The header is sent only when the storage client implements publicUploaderWithCacheControl; otherwise uploadWithClient calls UploadPublicObject and drops the header without an error. Covered by Test_UploadMetadataToS3_TimestampCacheControl in storage_test.go.
- **FindLatestMetadataVersion** — For the timestamp role it returns timestamp.json without listing storage. For other roles it lists the bucket prefix: an unversioned role.json counts as version 1, N.role.json as version N, the highest N wins, and non-numeric prefixes are skipped. A failed listing returns a wrapped storage error; ErrMetadataNotFound is returned only when the listing succeeded and matched nothing.
- **GetAllDelegatedRoles** — Known roles are excluded by suffix match, so 3.root.json is skipped. An unversioned name.json yields role name, and N.name.json yields name only when N parses as an integer; foo.bar.json is skipped. It reads through its own injectable listing var (listMetadataForGetAllDelegatedRoles), separate from ListMetadataForLatest.
- **ListMetadataFromS3** — Returns names relative to tuf_metadata/<admin>/<app>/ and drops keys not longer than that prefix. The config and storage factory are read through injectable vars (GetViperFor*, StorageFactoryFor*, getViperForList); the upload test swaps GetViperForUpload and StorageFactoryForUpload for mocks.
