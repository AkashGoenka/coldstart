---
id: server-handler-info-latest-edge-go-c29c52d4
type: file
character: single
title: "server/handler/info/latest_edge.go"
anchors:
  - {"path":"server/handler/info/latest_edge.go","symbols":["publishResponseToCDN","uploadResponseToCDN","BumpCDNEpoch"],"hash":"sha256:a050c1a044b8","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.438Z
edits: 2
---

# server/handler/info/latest_edge.go

CDN object key is responses/{owner}/{app}/ plus each non-empty channel, platform, arch, updater, then {version}.json (updater 'updater not supported' is stored under 'manual'). Publishing is an async goroutine with 5s timeout behind a 32-slot semaphore, silently skipped when full; the epoch captured before the lookup must still match before and after the upload, otherwise the object is deleted (an unreadable epoch never deletes). Upload is skipped when the existing ETag equals the MD5 of the body.
