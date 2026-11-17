---
id: src-emits-channel-ts-cda3e080
type: file
character: single
title: "src/emits/Channel.ts"
anchors:
  - {"path":"src/emits/Channel.ts","symbols":["emitDMMessageCreated"],"hash":"sha256:5b5c8617efae","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:58.481Z
edits: 1
---

# src/emits/Channel.ts

emitDMMessageCreated sends MESSAGE_CREATED to the user rooms of the inbox recipient and the inbox creator (userIds), not to a channel room, so a DM reaches both participants wherever they are connected. With a socketId, the sender's socket is excluded from the broadcast and then receives its own copy with socketId included.
