---
id: mongod-download-tokens-go-10f26019
type: file
character: hub
title: "mongod/download_tokens.go"
anchors:
  - {"path":"mongod/download_tokens.go","symbols":["FindPrivateArtifact","CanDownloadPrivateArtifact","HasDownloadToken","RegenerateDownloadToken","ListDownloadTokens","deleteDownloadTokens"],"hash":"sha256:90e85b3c5f12","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.619Z
edits: 1
---

# mongod/download_tokens.go

## Facets

- **FindPrivateArtifact** — A key on a public app returns ErrPrivateArtifactNotFound, the same as a missing key: the pipeline keeps only apps_meta.private = true. download_mode is copied from apps_meta, so the mode lives on the app, not on the token or the artifact.
- **CanDownloadPrivateArtifact** — Owner check first. With no team user the owner passes. A team user needs Permissions.Apps.Download and checkEntityAccess on the app, and on the channel when the artifact has one.
- **HasDownloadToken** — Matches token_hash together with app_id, channel_id and owner. A token of one channel never matches another channel's artifact. App-level tokens are stored with the zero ObjectID as channel_id.
- **RegenerateDownloadToken** — One token per (app_id, channel_id) via upsert. Regenerating overwrites token_hash, so the previous token stops matching at once. Only the hash and a prefix are stored; the raw token is returned by this call only. Public apps are refused (ErrDownloadTokenPublicApp). When any channel exists, an app-level token is refused (ErrDownloadTokenChannelRequired).
- **ListDownloadTokens** — Lists token_prefix, never the hash, filtered by the requester's editable apps.
- **deleteDownloadTokens** — Deletes by app_id (all of an app's tokens, channel ones included) or by channel_id. Other key types are a no-op.
