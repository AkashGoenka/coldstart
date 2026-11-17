---
id: src-cache-servercache-ts-5242d5ee
type: file
character: single
title: "src/cache/ServerCache.ts"
anchors:
  - {"path":"src/cache/ServerCache.ts","symbols":["getServerCache","updateServerCache","deleteServerCache"],"hash":"sha256:a087d36abe08","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.887Z
edits: 2
---

# src/cache/ServerCache.ts

Read-through snapshot (name, avatar, hexColor, defaultRoleId, public, scheduledForDeletion) written with a plain SET and no expiry, so it only changes through deleteServerCache or updateServerCache. updateServer does not refresh it; the only updateServerCache callers are Explore (public flag) and Server.transferServerOwnership (createdById). scheduledForDeletion is typed { scheduledAt: Date } but is a string after the JSON round trip; only its truthiness is used.
