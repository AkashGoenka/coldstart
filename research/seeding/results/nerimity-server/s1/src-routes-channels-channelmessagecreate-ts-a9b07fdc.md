---
id: src-routes-channels-channelmessagecreate-ts-a9b07fdc
type: file
character: single
title: "src/routes/channels/channelMessageCreate.ts"
anchors:
  - {"path":"src/routes/channels/channelMessageCreate.ts","symbols":["channelMessageCreate","route","queueRoute","verifyUpload","deleteFile"],"hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.339Z
edits: 3
---

# src/routes/channels/channelMessageCreate.ts

On send, nerimityCdnFileId is only validated as a string of 1-255 characters. The route then calls verifyUpload with groupId = the channel id and userId = the sender, and returns 403 with the CDN's message on failure. Before that it requires a confirmed email for any attachment (bots exempt) and repeats the mod/public/supporter gates. verifyUpload runs before the shadowBanned early return, which skips createMessage and makes no deleteFile call. If createMessage errors, a Local upload is removed with deleteFile(attachment.path), not awaited.
