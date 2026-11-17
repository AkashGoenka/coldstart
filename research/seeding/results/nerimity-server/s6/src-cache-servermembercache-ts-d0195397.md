---
id: src-cache-servermembercache-ts-d0195397
type: file
character: single
title: "src/cache/ServerMemberCache.ts"
anchors:
  - {"path":"src/cache/ServerMemberCache.ts","symbols":["getServerMemberCache","deleteServerMemberCache","deleteAllServerMemberCache"],"hash":"sha256:d6fb169d0335","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.878Z
edits: 2
---

# src/cache/ServerMemberCache.ts

One Redis hash per server, field per user id, filled on miss. permissions is the OR of role.permissions over the member's roleIds plus server.defaultRoleId; topRoleOrder is the highest role order held. The hash is never given an expiry, so entries leave only via deleteServerMemberCache (hDel) or deleteAllServerMemberCache (del). createServerRole, updateServerRole, deleteServerRole, updateServerRoleOrder and updateServerMember all clear the whole hash, but this does not touch the separate channel-override hashes in ChannelCache. deleteServer does not call it.
