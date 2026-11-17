---
id: how-an-uploaded-file-becomes-a-chat-message-attachment
type: flow
title: "how an uploaded file becomes a chat message attachment"
anchors:
  - {"path":"src/routes/channels/ChannelCdnGenerateToken.ts","hash":"sha256:72adc9045cb8","head":"feb30ff9ac54"}
  - {"path":"src/common/nerimityCDN.ts","hash":"sha256:125861b275d8","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/Message.ts","hash":"sha256:c71a4dcfd02b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.313Z
edits: 1
---

# how an uploaded file becomes a chat message attachment

The message route never receives file bytes or the upload token: the client gets a channel-scoped token from POST /api/channels/:channelId/cdn/token, uploads the file to the external CDN (no upload endpoint for it exists in this repo), then sends only the CDN fileId as nerimityCdnFileId, which this server confirms with the CDN's /internal/verify-file call using the sender's userId and the channel id as groupId. The token is never sent back to this server, so nothing here checks it at verify time. Two gates (mod/public-server/supporter) run at token mint and again at send, and the CDN-side checks are not visible in this repo. The verified response becomes the Local attachment object, and deleteMessage later removes that CDN file.

## Steps

1. `src/routes/channels/ChannelCdnGenerateToken.ts` (`ChannelCdnGenerateToken`) — applies the mod/public-server/supporter gates, then mints a token with channelId and returns only { token } to the client
2. `src/common/nerimityCDN.ts` (`generateToken`) — POST /internal/generate-token on LOCAL_NERIMITY_CDN with userId and channelId; the CDN's token is handed back to the route
3. `src/routes/channels/channelMessageCreate.ts` (`route`) — validates nerimityCdnFileId as a 1-255 char string, re-applies the gates, then calls verifyUpload with groupId = channel id
4. `src/common/nerimityCDN.ts` (`verifyUpload`) — POST /internal/verify-file with userId, fileId, groupId and imageOnly only when true; returns the CDN's path, dimensions, mimetype, duration, filesize, expireAt
5. `src/services/Message/Message.ts` (`createMessage`, `deleteMessage`, `AttachmentProviders`) — createMessage takes the verified object as its attachment option; deleteMessage deletes the CDN file of a Local attachment when the message row is removed

## Invariants

- Gates are repeated at send time: the mod, public-server and supporter/founder/admin checks in ChannelCdnGenerateToken.ts are copied into channelMessageCreate.ts, so minting a token alone does not let a user attach.
- verifyUpload is called with groupId = channel id for messages, the user id for posts (with imageOnly: true), the user id for avatar and banner in userUpdate.ts, and no groupId for server emoji (serverEmojiAdd.ts).
- When createMessage returns an error, the send route calls deleteFile on the uploaded path, only for provider Local, and does not await it.
- The shadowBanned branch of the send route runs after verifyUpload and returns a fake message before createMessage; it makes no deleteFile call.
- Every call from this repo to the CDN sends NERIMITY_CDN_SECRET in the Authorization header to LOCAL_NERIMITY_CDN. NERIMITY_CDN is the public base URL used to build image links in the open-graph routes.
