---
id: server-handler-create-finalize-go-7d5f6aec
type: file
character: hub
title: "server/handler/create/finalize.go"
anchors:
  - {"path":"server/handler/create/finalize.go","symbols":["FinalizeUpload","CopyVelopackInstallersToDefault","NotifySlackForApp"],"hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:36.644Z
edits: 1
---

# server/handler/create/finalize.go

## Facets

- **FinalizeUpload** — Shared tail of both upload paths. Cache invalidation runs first, then only the uploaded (channel, platform, arch) tuple is regenerated via info.TupleFromContext. Velopack additionally copies installers to the default key, and sparkle only materializes the feed.
- **CopyVelopackInstallersToDefault** — Copies each installer from its versioned key to the default key, using the private bucket when the app is private. A failed copy is logged and the loop continues; a failed storage-client creation returns silently after logging, so the default key can stay stale without an error to the caller.
- **NotifySlackForApp** — Gated on SLACK_ENABLE. It runs in a goroutine with a 10s timeout and re-reads the app by ID, so the Slack message describes the stored version rather than the request.
