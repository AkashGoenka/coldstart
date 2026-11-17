---
id: server-handler-download-download-go-e01b3b06
type: file
character: single
title: "server/handler/download/download.go"
anchors:
  - {"path":"server/handler/download/download.go","symbols":["DownloadArtifact","authorizeDownload"],"hash":"sha256:2c120c73a9df","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.466Z
edits: 2
---

# server/handler/download/download.go

authorizeDownload order: bearer session JWT (a bad JWT falls through, not an error), then download_mode 'unlisted' (grants key-only access, 302), then X-Download-Token. Only exact 'unlisted' counts, so missing/empty mode is strict. Denial and unknown key return the same 404; a DB error from CanDownloadPrivateArtifact is a 500, which is distinguishable. Only the JWT path returns JSON; others 302.
