---
id: src-index-ts-c5fb8502
type: file
character: single
title: "src/index.ts"
anchors:
  - {"path":"src/index.ts","symbols":["scheduleServerDeletion","scheduleSuspendedAccountDeletion","scheduleDeleteAccountContent","scheduleWebhookMessagesDelete","scheduleDeleteMessages","scheduleBumpReset","removeIPAddressSchedule","cleanupServerHourlyMessageCount"],"hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.804Z
edits: 2
---

# src/index.ts

Primary-process entry. Boot order is connectRedis, customRedisFlush, createQueueProcessor({prefix: env.TYPE}), createIO() with no http server, prisma.$connect, fork loop (min(3, cpus), 1 in DEV_MODE; workers get only CLUSTER_INDEX). All scheduled jobs live here and are registered only when env.TYPE is 'api', with no lock or leader election, so each api primary runs its own copy. Most are 1-minute setTimeout chains that handle ONE row per tick (scheduleServerDeletion: schedule rows older than 5 days; scheduleSuspendedAccountDeletion: suspensions older than 15 days), while scheduleDeleteAccountContent, scheduleWebhookMessagesDelete and scheduleDeleteMessages batch up to 300. scheduleServerDeletion and scheduleSuspendedAccountDeletion call prisma findFirst outside their try block, so a throwing query ends the chain; the suspended-deletion tick discards deleteAccount's result and marks the suspension userDeleted regardless. Post deletion tombstones posts (content null, deleted true) and deletes every repost of them, including reposts by other users. cleanupServerHourlyMessageCount is a 24h setInterval with no immediate run.
