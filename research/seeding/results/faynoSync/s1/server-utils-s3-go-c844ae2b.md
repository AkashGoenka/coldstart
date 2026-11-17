---
id: server-utils-s3-go-c844ae2b
type: file
character: single
title: "server/utils/s3.go"
anchors:
  - {"path":"server/utils/s3.go","symbols":["BuildObjectPlacement","UploadToS3","GeneratePresignedURL"],"hash":"sha256:5c1a3ac371b6","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:36.655Z
edits: 1
---

# server/utils/s3.go

BuildObjectPlacement sets Public to true for logo uploads or when the app is not private; public objects go to S3_BUCKET_NAME and private ones to S3_BUCKET_NAME_PRIVATE. UploadToS3 stores the URL returned by UploadPublicObject as the artifact link for public objects, and the API download link (DownloadLink from updaters.BuildS3Key) for private ones. The presigned complete path makes the same choice with uploader.PublicObjectURL versus file.DownloadLink. GeneratePresignedURL always signs against the private bucket, whatever the app's visibility.
