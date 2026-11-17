---
id: src-index-ts-c5fb8502
type: file
character: hub
title: "src/index.ts"
anchors:
  - {"path":"src/index.ts","symbols":["customRedisFlush","scheduleBumpReset","removeExpiredBannedIpsSchedule","scheduleDeleteAccountContent","scheduleServerDeletion","scheduleSuspendedAccountDeletion","scheduleDeleteMessages","scheduleWebhookMessagesDelete"],"hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.490Z
edits: 3
---

# src/index.ts

Boot is split by cluster.isPrimary: the primary runs the whole top-level block (connectRedis, customRedisFlush, createQueueProcessor, createIO() with no server, Prisma connect, then forks), and each child falls through to import('./worker'). The twelve schedulers start inside the primary's prisma.$connect().then, and only when TYPE is 'api'. Three are node-schedule rules with no tz set (bump reset weekly, vacuum and banned-IP cleanup daily), so the '0:00 UTC' in their comments holds only when the host runs in UTC. The rest are self-rescheduling loops (setInterval at 60s, hourly and daily; setTimeout chains at 1 min and 1 h), and the setInterval bodies have no in-flight guard, so a slow tick can overlap the next. The worker exit handler calls process.exit(code) on the primary with no per-worker restart; its comment gives the reason as redis cache issues with socket.io online users.

## Facets

- **scheduleServerDeletion** — One-minute setTimeout chain that picks one schedule_server_delete row older than 5 days (findFirst, no orderBy) and calls deleteServer. Its result tuple is not checked; a throw is logged and the row stays, so the next tick retries it.
- **scheduleSuspendedAccountDeletion** — Targets only permanent suspensions (expireAt null, userDeleted false) and measures the 15 days from suspension.suspendedAt. Order: deleteAllApplications, deleteOrLeaveAllServers, deleteAccount(deleteContent true), then update userDeleted true and reason null. The tuple returned by deleteAccount is discarded, so userDeleted is written even when deleteAccount returned an error; a thrown error skips the update and is retried next minute.
- **scheduleDeleteMessages** — Works on one schedule_message_delete row per 60 seconds (findFirst, no orderBy). Attachments are deleted through the CDN batch first, and if the CDN answers INVALID_PATH that flag is cleared. Messages are then removed with a raw DELETE of up to 300 rows for that channel; the channel row is deleted only when fewer than 300 rows were removed in that tick.
- **scheduleDeleteAccountContent** — Every 60 seconds: up to 300 messages sent by users with a schedule_account_content_delete row (hard delete), up to 300 posts of those users (soft delete: content null, deleted true, plus reposts, likes, polls, attachments, announcement and pinned rows), and up to 300 post likes whose liker has no account or application. The CDN attachment delete is called without await after the DB writes.
- **scheduleWebhookMessagesDelete** — Runs only in the 'api' process type (it is called inside the env.TYPE === 'api' block). Every 60 seconds it picks one webhook with deleting=true, deletes up to 300 of its messages and their attachment files, and deletes the webhook row only when no messages remain. The row therefore exists until its messages are gone.
