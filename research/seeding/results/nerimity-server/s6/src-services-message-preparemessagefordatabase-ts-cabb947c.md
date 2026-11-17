---
id: src-services-message-preparemessagefordatabase-ts-cabb947c
type: file
character: single
title: "src/services/Message/prepareMessageForDatabase.ts"
anchors:
  - {"path":"src/services/Message/prepareMessageForDatabase.ts","symbols":["prepareMessageForDatabase","processUserMentions","processRoleMentions","processQuotes","handleReplies"],"hash":"sha256:106ed5ef74c5","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.913Z
edits: 2
---

# src/services/Message/prepareMessageForDatabase.ts

processUserMentions matches [@:id] and returns every existing user with that id with no server-membership filter; membership and privacy are applied later in addMention and push. processRoleMentions needs serverId and canMentionRoles and looks roles up by id without a serverId filter. processQuotes applies a channel/membership filter only for webhook messages (no creatorId). handleReplies keeps only reply ids in the same channel; the route caps replyToMessageIds at 5.
