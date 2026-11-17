---
id: server-handler-info-access-go-be8377ee
type: file
character: single
title: "server/handler/info/access.go"
anchors:
  - {"path":"server/handler/info/access.go","symbols":["authorizeReadRequest","authorizeRead","respondAppNotFound"],"hash":"sha256:d6c6e35a64cc","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.627Z
edits: 1
---

# server/handler/info/access.go

authorizeRead is the read-side gate for private apps; public apps pass with no lookup. For a private app, a session of an allowed owner or team user passes, then unlisted mode passes for anyone with no credential, then a matching X-Download-Token passes. A denial goes through respondAppNotFound, whose body is the unknown-app error; the status is chosen by each caller (400 in FindLatestVersion, 500 in FetchLatestVersionOfApp). The velopack feed does not use this status path: a denied feed is 200 with empty Assets.
