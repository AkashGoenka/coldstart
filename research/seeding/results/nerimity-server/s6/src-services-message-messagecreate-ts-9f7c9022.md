---
id: src-services-message-messagecreate-ts-9f7c9022
type: file
character: single
title: "src/services/Message/MessageCreate.ts"
anchors:
  - {"path":"src/services/Message/MessageCreate.ts","symbols":["createMessageV2","handleMessageSideEffects","validateMessageOptions","incrementMessageCount"],"hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.905Z
edits: 2
---

# src/services/Message/MessageCreate.ts

createMessageV2 commits the message row and channel.lastMessagedAt in one transaction and returns the message before handleMessageSideEffects (mentions, emit, push, DM mention counter, OG embed, hourly count) finishes; that chain has a .then logger and no .catch. Server path: emit and push come after await addMention with no try/catch. DM path: a failed messageMention upsert returns before the DM emit and push, with the row already saved; the upsert is skipped for saved notes and bot recipients but the emit and push are not. @everyone mentions replace the mention id list with every member except the sender. Webhooks force isServerChannel true and skip the member lookup; opts.serverId is ignored (server comes from the channel cache). replaceBadWords applies to server text and DM text content. incrementMessageCount runs only for server channels and increments the user count only for non-bots; it is not awaited.
