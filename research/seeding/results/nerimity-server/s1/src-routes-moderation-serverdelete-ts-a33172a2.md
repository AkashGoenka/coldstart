---
id: src-routes-moderation-serverdelete-ts-a33172a2
type: file
character: single
title: "src/routes/moderation/serverDelete.ts"
anchors:
  - {"path":"src/routes/moderation/serverDelete.ts","symbols":["route","ScheduleServerDelete","scheduleServerDelete"],"hash":"sha256:e473c7fc5f39","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.645Z
edits: 1
---

# src/routes/moderation/serverDelete.ts

This route schedules a server deletion and deletes nothing: it creates a schedule_server_delete row, and the real deleteServer call comes about five days later from the api timer in src/index.ts (the direct call is commented out). Before responding it calls warnUsersBatch on the server creator with the moderator's reason, and in src/services/Moderation.ts a creator whose warnCount is already 2 or more (read before the increment) is suspended for 7 days, and 5 or more for 30 days, so scheduling a server delete can also suspend the owner. serverUndoDelete.ts cancels it by deleting that row.
