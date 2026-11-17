---
id: src-routes-posts-postcreate-ts-18588a9d
type: file
character: single
title: "src/routes/posts/postCreate.ts"
anchors:
  - {"path":"src/routes/posts/postCreate.ts","symbols":["route","verifyUpload"],"hash":"sha256:ec26b6b281c4","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.343Z
edits: 1
---

# src/routes/posts/postCreate.ts

Posts accept nerimityCdnFileId and call verifyUpload with groupId = the author's user id, not a channel, and imageOnly: true, so the CDN is asked to accept images only. A post with no text is valid when nerimityCdnFileId is set. The attachment object built here carries only width, height and path, with no provider, mimetype or filesize, unlike the Local attachment object the message route builds.
