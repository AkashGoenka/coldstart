---
id: src-services-message-messagecreate-ts-9f7c9022
type: file
character: hub
title: "src/services/Message/MessageCreate.ts"
anchors:
  - {"path":"src/services/Message/MessageCreate.ts","symbols":["createMessageV2","createMessageAndChannelUpdate","handleMessageSideEffects","incrementMessageCount"],"hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.480Z
edits: 2
---

# src/services/Message/MessageCreate.ts

createMessageV2 is the implementation behind the createMessage alias in Message.ts. It writes the message and channel.lastMessagedAt in one $transaction, and handleMessageSideEffects is fired without await afterwards, so mention notifications, sockets, push, incrementMessageCount and the OG embed fetch all run after the response. For webhook sends, isServerTextOrDMTextChannel is forced true, so replaceBadWords runs on the content. If the messageMention upsert fails on the DM path, the function returns before emitDMMessageCreated and sendDmPushNotification run.

## Facets

- **createMessageAndChannelUpdate** — Creator overrides: when username_override or avatar_url_override is non-empty after trimming, it finds a messageCreatorOverride row with that exact (username, avatarUrl) pair, or creates one, so override rows are shared by every webhook and message that uses the same pair. Avatar dimensions are fetched through proxyUrlImageDimensions only when there is an avatarUrl and no row with a non-null animatedAvatar; a failed fetch returns a 400 on avatar_url_override. A unique-constraint race on create falls back to a second findFirst.
- **createMessageV2** — Validation and message creation are awaited. handleMessageSideEffects is not awaited, and only its returned error is logged.
