---
id: server-handler-create-upload-go-7fde38fa
type: file
character: single
title: "server/handler/create/upload.go"
anchors:
  - {"path":"server/handler/create/upload.go","symbols":["UploadApp","PlanUploadPlacements","InvalidatePublishCaches","InvalidateAppCaches","InvalidateCDNResponseCache","ValidateUpdaterUpload"],"hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.445Z
edits: 2
---

# server/handler/create/upload.go

UploadApp runs PlanUploadPlacements before any S3 write (same key/extension twice in one request = 400; already stored in the version = 409), then stores every file, then a second loop calls repository.Upload per link; a failure in the second loop returns 500 with earlier objects and DB rows left in place. Cache invalidation is gated on the form field publish being exactly true/false: without it the Redis deletion and CDN sweep are skipped, but feed materialization still runs. Redis invalidation (InvalidateCache) is scoped to one channel and needs performanceMode; the CDN sweep ignores channel/platform/arch, bumps the epoch first and runs whenever S3_BUCKET_NAME_CDN is set. Feed files are found by case-insensitive name (releases.*.json, appcast*.xml; first match only) and the name tests are duplicated in the updater packages.
