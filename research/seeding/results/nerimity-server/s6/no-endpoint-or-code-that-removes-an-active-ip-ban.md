---
id: no-endpoint-or-code-that-removes-an-active-ip-ban
type: lesson
kind: absence
title: "no endpoint or code that removes an active IP ban"
scope: {"terms":["bannedIp","unban","removeIpBan","IP ban"]}
status: active
updated: 2026-11-17T03:29:05.225Z
edits: 1
---

# no endpoint or code that removes an active IP ban

bannedIp rows are deleted only in src/services/User/User.ts (expired ban deleted when read) and src/index.ts removeExpiredBannedIps (deleteMany on expireAt). The unsuspend route does not touch bannedIp.

## Scope (absence — freshness = re-run this search)

- terms: `bannedIp`, `unban`, `removeIpBan`, `IP ban`
