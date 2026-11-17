---
id: src-cache-channelcache-ts-fbde1b49
type: file
character: single
title: "src/cache/ChannelCache.ts"
anchors:
  - {"path":"src/cache/ChannelCache.ts","symbols":["getChannelForUserCache","setServerChannelMemberPermissions","removeServerMemberPermissionsCache"],"hash":"sha256:0ed495573d75","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.331Z
edits: 1
---

# src/cache/ChannelCache.ts

Per-member channel masks live in one Redis hash per channel (SERVER_CHANNEL_PERMISSION_KEY_HASH, field = userId). On a miss, setServerChannelMemberPermissions ORs the channel's role rows for the member's roleIds plus the server default role, then writes the hash without awaiting the Redis multi, so the caller returns before the write lands. The 24h expire is set on the whole channel hash on every write, so any member's write refreshes it and an idle hash lapses 24h after its last write. removeServerMemberPermissionsCache deletes the hash or only the listed user fields.
