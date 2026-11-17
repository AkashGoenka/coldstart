---
id: how-a-server-scheduled-for-deletion-is-locked-and-then-remov
type: flow
title: "how a server scheduled for deletion is locked and then removed"
anchors:
  - {"path":"src/routes/moderation/serverDelete.ts","hash":"sha256:e473c7fc5f39","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/serverUndoDelete.ts","hash":"sha256:7ec4594e5624","head":"feb30ff9ac54"}
  - {"path":"src/cache/ServerCache.ts","hash":"sha256:a087d36abe08","head":"feb30ff9ac54"}
  - {"path":"src/middleware/serverMemberVerification.ts","hash":"sha256:2020f231f2d2","head":"feb30ff9ac54"}
  - {"path":"src/middleware/channelVerification.ts","hash":"sha256:a4fa97aa5bd6","head":"feb30ff9ac54"}
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/services/Server.ts","hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.041Z
edits: 1
---

# how a server scheduled for deletion is locked and then removed

Scheduling only inserts a ScheduleServerDelete row and deletes the cached server snapshot; the server, members and channels stay live. The lock is a per-request 403 from middleware reading the cached scheduledForDeletion flag, and the actual removal is a hard delete by an api-process timer in src/index.ts for the first row older than 5 days.

## Steps

1. `src/routes/moderation/serverDelete.ts` (`route`) — creates the schedule row (500 if the create fails, e.g. already scheduled), deletes the ServerCache key, emits
2. `src/cache/ServerCache.ts` (`getServerCache`, `deleteServerCache`) — snapshot with scheduledForDeletion, repopulated from the DB on next read
3. `src/middleware/serverMemberVerification.ts` (`serverMemberVerification`) — 403 when flagged unless ignoreScheduledDeletion
4. `src/middleware/channelVerification.ts` (`channelVerification`) — same 403 for SERVER_TEXT and CATEGORY channels
5. `src/index.ts` (`scheduleServerDeletion`) — one-minute setTimeout chain, one server per tick, calls deleteServer
6. `src/services/Server.ts` (`deleteServer`) — hard delete in a transaction; the schedule row goes by cascade; clears server and channel caches

## Invariants

- Every write to the schedule row (schedule and undo) is followed by deleteServerCache, otherwise middleware keeps the old flag.
- The routes that opt out via ignoreScheduledDeletion are DELETE /servers/:serverId and POST /servers/:serverId/leave.
- joinServer reads scheduledForDeletion from the DB, not the cache.
- deleteServer does not call deleteAllServerMemberCache, so the member hash for the deleted server stays in Redis.
