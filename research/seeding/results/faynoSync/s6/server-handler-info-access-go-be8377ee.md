---
id: server-handler-info-access-go-be8377ee
type: file
character: single
title: "server/handler/info/access.go"
anchors:
  - {"path":"server/handler/info/access.go","symbols":["authorizeRead","authorizeReadRequest","respondAppNotFound"],"hash":"sha256:d6c6e35a64cc","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.472Z
edits: 2
---

# server/handler/info/access.go

authorizeRead for private apps: bearer session via CanDownloadPrivateArtifact, then unlisted download mode (no credential), then the download-token header. Every denial returns the same body as an unknown app (respondAppNotFound), but the HTTP status is the caller's notFoundStatus (400 from FindLatestVersion, 500 from FetchLatestVersionOfApp). An unlisted private app is readable anonymously yet still bypasses the Redis cache because the cache gate checks Private.
