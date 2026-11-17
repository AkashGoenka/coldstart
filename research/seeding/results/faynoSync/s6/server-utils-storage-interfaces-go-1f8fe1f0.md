---
id: server-utils-storage-interfaces-go-1f8fe1f0
type: file
character: single
title: "server/utils/storage/interfaces.go"
anchors:
  - {"path":"server/utils/storage/interfaces.go","symbols":["PresignedUploader","ObjectStat","StorageClient"],"hash":"sha256:11164fb07e83","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.462Z
edits: 2
---

# server/utils/storage/interfaces.go

Presigned upload is a separate optional interface (PresignedUploader), not part of StorageClient: aws, digitalocean (via BaseS3Client) and gcp implement it, minio does not (presigned_upload_test asserts this), so init returns 501 there. ObjectStat MD5 is empty for multipart objects, which is how verifyPresignedFile rejects them. Driver names are minio, aws, digitalocean, gcp (not gcs); the factory caches clients per viper pointer + driver and does not cache failures.
