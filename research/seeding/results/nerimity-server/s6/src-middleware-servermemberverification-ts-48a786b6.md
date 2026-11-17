---
id: src-middleware-servermemberverification-ts-48a786b6
type: file
character: single
title: "src/middleware/serverMemberVerification.ts"
anchors:
  - {"path":"src/middleware/serverMemberVerification.ts","symbols":["serverMemberVerification"],"hash":"sha256:2020f231f2d2","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.864Z
edits: 2
---

# src/middleware/serverMemberVerification.ts

Takes serverId from req.params (or req.body.serverId with serverIdInBody), looks up the member cache first and the server snapshot second, so a non-member gets the membership 403 before the existence or scheduled-deletion check. 403 'This server is scheduled for deletion.' unless ignoreScheduledDeletion (used by serverDelete and serverLeave). Loads req.serverMemberCache and req.serverCache for the role middleware; it checks no permission bits itself. The allowBot option is declared but not read here.
