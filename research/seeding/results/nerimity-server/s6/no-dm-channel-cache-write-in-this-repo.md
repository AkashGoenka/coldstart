---
id: no-dm-channel-cache-write-in-this-repo
type: lesson
kind: absence
title: "no DM channel cache write in this repo"
scope: {"terms":["DM_CHANNEL_KEY_STRING","getDMChannelCache"]}
status: active
updated: 2026-11-17T03:29:05.240Z
edits: 1
---

# no DM channel cache write in this repo

getDMChannelCache in src/cache/ChannelCache.ts reads DM_CHANNEL_KEY_STRING, the only reference to that key in src; nothing sets it, so DM channels are not served from Redis as channels (only the per-user inbox entry is cached).

## Scope (absence — freshness = re-run this search)

- terms: `DM_CHANNEL_KEY_STRING`, `getDMChannelCache`
