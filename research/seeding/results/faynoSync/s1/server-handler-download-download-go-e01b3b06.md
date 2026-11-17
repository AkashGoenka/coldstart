---
id: server-handler-download-download-go-e01b3b06
type: file
character: single
title: "server/handler/download/download.go"
anchors:
  - {"path":"server/handler/download/download.go","symbols":["DownloadArtifact","authorizeDownload"],"hash":"sha256:2c120c73a9df","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:08.350Z
edits: 2
---

# server/handler/download/download.go

authorizeDownload checks a bearer session first: an owner or allowed team user gets JSON {download_url}. Otherwise, an unlisted artifact is allowed to anyone with a 302 redirect, and the X-Download-Token header is checked only for non-unlisted artifacts. Every denial is the same 404 'Artifact not found'. A session lookup error is swallowed and treated as anonymous, while an error from CanDownloadPrivateArtifact or HasDownloadToken returns a 500. The presigned URL lifetime is 15 minutes.
