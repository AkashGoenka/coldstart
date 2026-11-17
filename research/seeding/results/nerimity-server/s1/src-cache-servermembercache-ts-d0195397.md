---
id: src-cache-servermembercache-ts-d0195397
type: file
character: single
title: "src/cache/ServerMemberCache.ts"
anchors:
  - {"path":"src/cache/ServerMemberCache.ts","symbols":["getServerMemberCache"],"hash":"sha256:d6fb169d0335","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:07.334Z
edits: 1
---

# src/cache/ServerMemberCache.ts

Caches each member's server-wide role mask in the SERVER_MEMBERS hash (field = userId). permissions is the bitwise OR of all the member's role masks plus the server default role, so the ADMIN bit on any one role makes that member an admin in every check that reads this field (channelPermissions and memberHasRolePermission). A miss rebuilds it from the database.
