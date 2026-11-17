---
id: how-a-scheduled-server-deletion-suspended-account-deletion-o
type: flow
title: "how a scheduled server deletion, suspended-account deletion or message purge finishes"
anchors:
  - {"path":"src/routes/moderation/serverDelete.ts","hash":"sha256:e473c7fc5f39","head":"feb30ff9ac54"}
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/services/Server.ts","hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
  - {"path":"src/services/Channel.ts","hash":"sha256:260b96bf059b","head":"feb30ff9ac54"}
  - {"path":"src/services/User/UserManagement.ts","hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
  - {"path":"src/services/Moderation.ts","hash":"sha256:84b473cb43d1","head":"feb30ff9ac54"}
  - {"path":"src/common/nerimityCDN.ts","hash":"sha256:125861b275d8","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/serverUndoDelete.ts","hash":"sha256:7ec4594e5624","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.633Z
edits: 1
---

# how a scheduled server deletion, suspended-account deletion or message purge finishes

A moderator server delete deletes nothing at request time: serverDelete writes a schedule_server_delete row, and the api process's one-minute timer calls deleteServer about five days later. Channel and account purges are separate one-minute loops that work in fixed batches of 300 rows, so the data is removed over many ticks rather than in one request. All of these timers start only when env.TYPE is 'api'.

## Steps

1. `src/routes/moderation/serverDelete.ts` (`route`) — DELETE /moderation/servers/:serverId: checks the password, creates the schedule_server_delete row, clears the server cache, warns the creator and writes the mod audit log. Its deleteServer call is commented out.
2. `src/index.ts` (`scheduleServerDeletion`) — one-minute setTimeout chain: picks one schedule row whose scheduledAt is older than 5 days (no orderBy) and calls deleteServer on it.
3. `src/services/Server.ts` (`deleteServer`) — transaction: marks the server's webhooks and channels deleting, deletes the server row (which cascades the schedule row) and upserts a scheduleMessageDelete row per channel. Messages are not removed here.
4. `src/services/Channel.ts` (`deleteServerChannel`) — single-channel delete: marks the channel and its webhooks deleting and upserts scheduleMessageDelete for it. Refuses the default channel.
5. `src/index.ts` (`scheduleDeleteMessages`) — one-minute timer: takes one schedule_message_delete row, runs the CDN attachment batch first, then DELETEs up to 300 messages of that channel; when fewer than 300 were deleted, it deletes the channel row in the same transaction as clearing the flag.
6. `src/index.ts` (`scheduleSuspendedAccountDeletion`) — one-minute timer: finds one permanent suspension (expireAt null, userDeleted false) whose suspendedAt is older than 15 days, deletes its applications, leaves or deletes its servers, calls deleteAccount with deleteContent, then sets userDeleted true and clears reason.
7. `src/services/User/UserManagement.ts` (`deleteAccount`) — with deleteContent, upserts a schedule_account_content_delete row, blanks avatar and banner, renames the user to Deleted User/Bot plus a tag and deletes the account row. The user row itself is kept.
8. `src/index.ts` (`scheduleDeleteAccountContent`) — one-minute timer: each tick soft-deletes up to 300 posts and hard-deletes up to 300 messages and 300 post likes of deleted accounts, then fires the CDN attachment deletion without awaiting it.

## Invariants

- The server row delete cascades the schedule_server_delete row (prisma ScheduleServerDelete.server onDelete Cascade), so the five-day timer stops finding a server once deleteServer has committed.
- deleteServer does not delete messages; scheduleDeleteMessages does, one channel per tick, 300 rows per tick.
- Deleted-account content is purged by scheduleDeleteAccountContent, which keeps matching a user until its schedule_account_content_delete row exists; no code under src/ deletes those rows (only the upsert in UserManagement.ts and the reads in index.ts).
- Every purge timer is registered only in the api process (index.ts, inside the env.TYPE === 'api' branch).
