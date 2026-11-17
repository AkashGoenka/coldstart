---
id: src-cache-channelcache-ts-fbde1b49
type: file
character: single
title: "src/cache/ChannelCache.ts"
anchors:
  - {"path":"src/cache/ChannelCache.ts","symbols":["getChannelForUserCache","setServerChannelMemberPermissions","removeServerMemberPermissionsCache","addChannelToCache","getDMChannelCache","deleteAllInboxCache"],"hash":"sha256:0ed495573d75","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.882Z
edits: 2
---

# src/cache/ChannelCache.ts

Per-channel member override bits are the OR of ServerChannelPermissions rows for the member's roleIds plus the default role, stored in one Redis hash per channel (field = user id) whose 24h EXPIRE is reset on every write (not awaited). removeServerMemberPermissionsCache deletes one user's field, or the whole hash without userIds. addChannelToCache queries with deleting: null, so a channel marked deleting reads as 'Channel does not exist.'. getChannelForUserCache reads the server snapshot at request time, so the scheduled-deletion flag always comes from ServerCache. getDMChannelCache reads a key nothing in src writes, so DM channels hit the database each time; only the per-user INBOX entry (canMessage from block rows then DM status settings) is cached, invalidated only by deleteAllInboxCache / deleteAllInboxCacheInServer.
