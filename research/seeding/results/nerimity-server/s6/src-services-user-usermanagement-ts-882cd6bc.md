---
id: src-services-user-usermanagement-ts-882cd6bc
type: file
character: single
title: "src/services/User/UserManagement.ts"
anchors:
  - {"path":"src/services/User/UserManagement.ts","symbols":["deleteAccount","deleteAccountFromDatabase","addDeviceWithSession","removeSessionsByUserId","logout","deleteOrLeaveAllServers"],"hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.941Z
edits: 2
---

# src/services/User/UserManagement.ts

Session and account lifecycle. addDeviceWithSession upserts userDevice by (userId, ipAddress, sessionId); those rows are the DB fallback for session lookup. removeSessionsByUserId deletes session keys then device rows in one transaction; logout deletes the device row, the session key and disconnects the 'ses:'+sessionId room. deleteAccount refuses non-bot users who still own servers or applications, runs deleteAccountFromDatabase (one transaction: user row kept and renamed 'Deleted User <tag>', account, devices, connections, grants deleted; with deleteContent upserts ScheduleAccountContentDelete; webhooks marked deleting only if avatar is null; a shadow-banned user with an email gets a userDeleted Suspension holding the sha256 of the email), then clears the user cache and disconnects sockets without removing session keys. deleteAllApplications and deleteOrLeaveAllServers wait 500 ms per item.
