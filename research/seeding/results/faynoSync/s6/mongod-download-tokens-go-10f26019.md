---
id: mongod-download-tokens-go-10f26019
type: file
character: single
title: "mongod/download_tokens.go"
anchors:
  - {"path":"mongod/download_tokens.go","symbols":["FindPrivateArtifact","CanDownloadPrivateArtifact","HasDownloadToken","RegenerateDownloadToken","SessionUsername"],"hash":"sha256:90e85b3c5f12","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.469Z
edits: 2
---

# mongod/download_tokens.go

FindPrivateArtifact matches artifacts.s3_key with $limit 1 before the $lookup/private:true filter, so a key owned by a non-private app yields not-found. CanDownloadPrivateArtifact requires owner == artifact owner; team users additionally need apps.download, the app in allowed and, if the artifact has a channel, the channel in allowed. SessionUsername accepts only session JWTs (fns_ cannot read). HasDownloadToken matches token_hash + app_id + channel_id + owner; RegenerateDownloadToken upserts on (app_id, channel_id) and replaces the hash, and with no channel returns ErrDownloadTokenChannelRequired whenever any channel_name document exists in apps_meta (no owner filter). Deleting an app/channel deletes its tokens, errors logged only.
