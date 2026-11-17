---
id: src-services-server-ts-aa16e10a
type: file
character: single
title: "src/services/Server.ts"
anchors:
  - {"path":"src/services/Server.ts","symbols":["deleteServer","joinServer","leaveServer","kickServerMember","banServerMember","updateServer"],"hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.949Z
edits: 2
---

# src/services/Server.ts

deleteServer hard-deletes the server in one transaction together with the webhook/channel deleting marks and scheduleMessageDelete upserts (the ScheduleServerDelete row goes by DB cascade), then clears the server and channel caches but not the SERVER_MEMBERS hash. joinServer checks scheduledForDeletion from a direct DB read, not ServerCache. kickServerMember and banServerMember both delegate to leaveServer, which writes the ban row; leaveServer skips the leave system message on a scheduled server and, with no membership row and ban true, writes the ban and returns early without clearing channel permission caches. updateServer does not refresh ServerCache; only transferServerOwnership calls updateServerCache.
