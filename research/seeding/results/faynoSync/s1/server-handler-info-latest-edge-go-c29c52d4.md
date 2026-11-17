---
id: server-handler-info-latest-edge-go-c29c52d4
type: file
character: single
title: "server/handler/info/latest_edge.go"
anchors:
  - {"path":"server/handler/info/latest_edge.go","symbols":["publishResponseToCDN","uploadResponseToCDN","ReadCDNEpoch","BumpCDNEpoch"],"hash":"sha256:a050c1a044b8","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:41.945Z
edits: 2
---

# server/handler/info/latest_edge.go

CDN publish path for latest-version responses. publishResponseToCDN starts uploadResponseToCDN in a goroutine bounded by a 32-slot semaphore (cdnPublishSlots); when all slots are busy the publish is skipped, not queued. ReadCDNEpoch captures the per-app counter before the response is computed, and uploadResponseToCDN compares it before uploading and again after, deleting the object it wrote if the counter changed (it keeps the object if the read failed). Before uploading, it skips when the existing object's ETag equals the MD5 of the new body. Object keys are responses/<owner>/<app>/[channel/platform/arch/updater/]<version>.json, with the not-supported updater stored under manual; objects are served with max-age=60, must-revalidate.
