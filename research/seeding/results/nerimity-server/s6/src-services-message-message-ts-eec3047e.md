---
id: src-services-message-message-ts-eec3047e
type: file
character: single
title: "src/services/Message/Message.ts"
anchors:
  - {"path":"src/services/Message/Message.ts","symbols":["createMessage","addMention","addMessageEmbed"],"hash":"sha256:c71a4dcfd02b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.909Z
edits: 2
---

# src/services/Message/Message.ts

createMessage and editMessage are aliases of createMessageV2 and editMessageV2 at the bottom of the file; work happens in MessageCreate.ts. addMention returns immediately without a webhookId or requesterId. For private channels it keeps only the creator, ADMIN members and members whose roles grant PUBLIC_CHANNEL on that channel; it drops the requester, non-members, users with a BLOCKED friend row against the requester, bots, and MUTE ping mode (channel setting beats server setting), then writes messageNotification and messageMention in one transaction. It never reads message.silent. addMessageEmbed fetches OG tags for the first URL and is not awaited.
