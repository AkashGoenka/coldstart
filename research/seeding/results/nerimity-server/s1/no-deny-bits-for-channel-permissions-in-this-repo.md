---
id: no-deny-bits-for-channel-permissions-in-this-repo
type: lesson
kind: absence
title: "no deny bits for channel permissions in this repo"
scope: {"terms":["deny","ServerChannelPermissions","addBit","channel permission"]}
status: active
updated: 2026-11-17T03:25:07.351Z
edits: 1
---

# no deny bits for channel permissions in this repo

Searched prisma/schema.prisma (ServerChannelPermissions has one nullable permissions Int per role and channel) and src/cache/ChannelCache.ts (setServerChannelMemberPermissions merges with addBit, an OR). There is no deny field and no subtracting merge, so a role cannot remove a channel bit another role grants.

## Scope (absence — freshness = re-run this search)

- terms: `deny`, `ServerChannelPermissions`, `addBit`, `channel permission`
