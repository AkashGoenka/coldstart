---
id: src-services-message-message-ts-eec3047e
type: file
character: single
title: "src/services/Message/Message.ts"
anchors:
  - {"path":"src/services/Message/Message.ts","symbols":["createMessage","addMention","addMessageEmbed","deleteMessage","AttachmentProviders"],"hash":"sha256:c71a4dcfd02b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:17.351Z
edits: 2
---

# src/services/Message/Message.ts

AttachmentProviders.Local ('local', commented as the nerimity cdn) marks an attachment whose bytes sit on the CDN; GoogleDrive attachments store only a fileId. deleteMessage removes the message row first and, only if that succeeded, calls deleteFile on attachments[0].path when that attachment's provider is Local. The CDN delete is not awaited and its result is not checked, and only index 0 is considered.

## Facets

- **createMessage** — Alias at line 541: `export const createMessage = createMessageV2`. The implementation is MessageCreate.ts; all callers in this repo (route, webhookExecute, webhookExecuteGitHub, Ticket, Voice, Explore) import this name. — [[how-a-message-create-request-reaches-the-database-sockets-an]]
- **addMention** — Recipient filter order: (1) requester is excluded; (2) in a private channel (default role lacks PUBLIC_CHANNEL) only the server owner, or members whose role permissions include ADMIN or whose channel permissions include PUBLIC_CHANNEL, survive; in a public channel this step is skipped; (3) the user must be in the server, must not be a bot, and must have no BLOCKED friend row whose recipientId is the requester; (4) a channel or server ping mode of MUTE drops the user. Writes messageNotification and messageMention in one $transaction and emits nothing. For [@:e] the caller passes every server member except the sender before these filters. — [[how-a-message-create-request-reaches-the-database-sockets-an]]
- **addMessageEmbed** — Takes only the first http(s) URL in content (urlRegex), fetches OG tags with getOGTags, writes them to message.embed and emits MESSAGE_UPDATED for server channels. It is called from handleMessageSideEffects for CONTENT messages without await.
