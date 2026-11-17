---
id: src-services-message-preparemessagefordatabase-ts-cabb947c
type: file
character: single
title: "src/services/Message/prepareMessageForDatabase.ts"
anchors:
  - {"path":"src/services/Message/prepareMessageForDatabase.ts","symbols":["prepareMessageForDatabase","processUserMentions","processRoleMentions","processQuotes","handleReplies"],"hash":"sha256:106ed5ef74c5","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:58.470Z
edits: 1
---

# src/services/Message/prepareMessageForDatabase.ts

Turns the markers in content into the DB connect lists. [@:id] matches digits only and resolves users by id with no server-membership check. [r:id] is looked up only when serverId and canMentionRoles are set, and the query filters by role id alone, with no serverId filter. [q:id] applies the membership-or-inbox channel filter only when creatorId is absent (the webhook path); user-authored messages pass creatorId, so that filter is skipped and any CONTENT message id is matched. replyToMessageIds are kept only when they belong to the same channelId.
