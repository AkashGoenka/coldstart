---
id: how-a-private-artifact-download-is-authorized
type: flow
title: "how a private artifact download is authorized"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/download/download.go","hash":"sha256:2c120c73a9df","head":"ca2f88a4fe38"}
  - {"path":"mongod/download_tokens.go","hash":"sha256:90e85b3c5f12","head":"ca2f88a4fe38"}
  - {"path":"server/utils/s3.go","hash":"sha256:5c1a3ac371b6","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/access.go","hash":"sha256:d6c6e35a64cc","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.364Z
edits: 1
---

# how a private artifact download is authorized

GET /download is registered before authMiddleware, so the session-JWT, unlisted-mode and X-Download-Token checks all run inside DownloadArtifact, in that order, and every denial returns the same 404 as an unknown key. Only the JWT path returns JSON; unlisted and token callers get a 302 to a 15-minute presigned URL.

## Steps

1. `server/server.go` (`StartServer`) — /download registered above router.Use(authMiddleware)
2. `server/handler/download/download.go` (`DownloadArtifact`, `authorizeDownload`) — a bad Bearer JWT falls through to the next check; only exact download_mode 'unlisted' grants key-only access
3. `mongod/download_tokens.go` (`FindPrivateArtifact`, `CanDownloadPrivateArtifact`, `HasDownloadToken`) — artifact by s3_key; token matched by hash + app_id + channel_id + owner
4. `server/utils/s3.go` (`GeneratePresignedURL`) — 15-minute presigned URL

## Invariants

- fns_ API tokens cannot authorize a private read
- A download token opens only artifacts of its own app, channel and owner
