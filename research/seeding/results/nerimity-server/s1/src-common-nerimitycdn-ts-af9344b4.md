---
id: src-common-nerimitycdn-ts-af9344b4
type: file
character: hub
title: "src/common/nerimityCDN.ts"
anchors:
  - {"path":"src/common/nerimityCDN.ts","symbols":["verifyUpload","generateToken","deleteFile","deleteImageBatch","deleteChannelAttachmentBatch","proxyUrlImageDimensions"],"hash":"sha256:125861b275d8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.679Z
edits: 2
---

# src/common/nerimityCDN.ts

## Facets

- **verifyUpload** — Sends only userId, fileId, groupId and imageOnly (only when true) to POST /internal/verify-file; the token from generateToken is not part of this call. A non-200 returns the CDN's JSON message as the error; a network failure returns the fixed string 'Could not connect to the CDN.'
- **generateToken** — POST /internal/generate-token with userId and an optional channelId. channelId is set only by the channel route (ChannelCdnGenerateToken.ts), so the user-level route mints a token without one.
- **deleteFile** — DELETE to the CDN root with body {path}. Errors are logged with console.trace and swallowed; it resolves to undefined and callers do not await it.
- **deleteImageBatch** — Fire-and-forget from the caller's point of view: any fetch error is swallowed by an empty catch and nothing is returned. Callers in src/index.ts run it after the database rows are already deleted and do not await it, so a failed CDN call is not retried by the purge loops.
- **deleteChannelAttachmentBatch** — Returns a tuple. A network failure maps to CDN_CONNECTION_FAIL. The inline comment says it deletes 1000 files per call; the CDN side is not in this repo, so only the call is verified.
- **proxyUrlImageDimensions** — GET proxy-dimensions?url=... on the CDN. Any non-200 or network error resolves to [null, true] with no message.
