---
id: server-handler-create-upload-go-7fde38fa
type: file
character: hub
title: "server/handler/create/upload.go"
anchors:
  - {"path":"server/handler/create/upload.go","symbols":["UploadApp","InvalidatePublishCaches","InvalidateCDNResponseCache","InvalidateAppCaches","InvalidateCache"],"hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:41.957Z
edits: 2
---

# server/handler/create/upload.go

## Facets

- **UploadApp** — Conflicts are planned with PlanUploadPlacements before any object is written, but if a later file fails in the loop, objects already written by that request are not deleted. The 200 response reports only results[0]'s app ID.
- **InvalidatePublishCaches** — Does nothing unless the request's publish field, trimmed and lowercased, is exactly true or false (explicitPublishValue). It then invalidates only the request's channel via InvalidateAppCaches. Also called from update.go and finalize.go.
- **InvalidateCDNResponseCache** — Calls info.BumpCDNEpoch before listing responses/<owner>/<app>/ and deleting them, so publishes that read the old epoch are dropped. The bump happens before the storage client is created, so it stays in effect even if listing or deleting then fails. Tested by TestInvalidateAppCaches_SweepsCDNResponsesWhenFlagIsOff in create/cdn_sweep_test.go.
- **InvalidateAppCaches** — Two independent steps: Redis key deletion, only when performanceMode and rdb are set, scoped to each channel passed in; then InvalidateCDNResponseCache, which runs whenever the CDN bucket is configured. The comment says the CDN sweep exists for copies published while cdn_edge was on or before the private-app backfill.
- **InvalidateCache** — Redis SCAN with the CacheKeyPattern glob, then one DEL per key; a failed DEL is logged and the loop continues, and only a SCAN error is returned.
