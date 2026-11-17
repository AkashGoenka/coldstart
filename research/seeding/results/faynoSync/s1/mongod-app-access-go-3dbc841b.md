---
id: mongod-app-access-go-3dbc841b
type: file
character: single
title: "mongod/app_access.go"
anchors:
  - {"path":"mongod/app_access.go","symbols":["ResolveAppAccess"],"hash":"sha256:1843976c2805","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.623Z
edits: 1
---

# mongod/app_access.go

ResolveAppAccess reads private, download_mode and cdn_edge from apps_meta with a projection before any version data is built, so read paths can deny early. An unknown app returns ErrAppNotFound. An unknown channel name does not error: ChannelID stays zero, and the comment says no token can match that zero id, but app-level tokens are stored with the zero ObjectID (see RegenerateDownloadToken in download_tokens.go). The channel lookup runs only for private apps with a non-empty channel name.
