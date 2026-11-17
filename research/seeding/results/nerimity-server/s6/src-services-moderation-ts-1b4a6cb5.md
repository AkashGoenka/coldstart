---
id: src-services-moderation-ts-1b4a6cb5
type: file
character: single
title: "src/services/Moderation.ts"
anchors:
  - {"path":"src/services/Moderation.ts","symbols":["suspendUsersBatch","warnUsersBatch","disconnectUsers"],"hash":"sha256:84b473cb43d1","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.934Z
edits: 2
---

# src/services/Moderation.ts

suspendUsersBatch refuses the whole batch if any target has the FOUNDER badge (returns an error object, not an HTTP status), and warnUsersBatch goes through it. warnUsersBatch reads account.warnCount before incrementing: a read of 2 to 4 (third warning on) suspends 7 days with IP ban, 5 or more 30 days. Suspension is an upsert; days 0 means expireAt null (permanent). With ipBan, bannedIp rows cover every IP shared with any userDevice of the suspended users and expire after 7 days regardless of suspension length; removeAllowedIPsCache forces banned IPs back through the slow path. The ip-ban audit write swallows errors. disconnectUsers clears the user cache and emits an error with disconnect true. The routes cap days at 31 even though the validator allows more. Moderator actions go to modAuditLog, not the server AuditLog.
