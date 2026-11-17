---
id: how-a-self-service-account-deletion-reaches-the-content-purg
type: flow
title: "how a self-service account deletion reaches the content purge"
anchors:
  - {"path":"src/routes/users/userDeleteAccount.ts","hash":"sha256:5332df1e07e1","head":"feb30ff9ac54"}
  - {"path":"src/services/User/UserManagement.ts","hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
  - {"path":"src/index.ts","hash":"sha256:bdf8ed3faede","head":"feb30ff9ac54"}
  - {"path":"src/common/database.ts","hash":"sha256:f8b8593d948f","head":"feb30ff9ac54"}
  - {"path":"src/common/nerimityCDN.ts","hash":"sha256:125861b275d8","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.050Z
edits: 1
---

# how a self-service account deletion reaches the content purge

Self-service deletion does not remove messages or posts inline: deleteAccount renames and detaches the user in one transaction and, with deleteContent, upserts a ScheduleAccountContentDelete row that the 60-second job scheduleDeleteAccountContent in src/index.ts later drains in batches of 300. The user row is kept (renamed 'Deleted User <tag>') so message and post foreign keys stay valid. The 15-day suspended-account deletion calls the same deleteAccount but discards its returned error tuple.

## Steps

1. `src/routes/users/userDeleteAccount.ts` (`route`) — checks the password, passes deleteContent through, returns 400 with deleteAccount's error
2. `src/services/User/UserManagement.ts` (`deleteAccount`, `deleteAccountFromDatabase`) — refuses non-bot deletion while servers or applications remain, then runs the transaction
3. `src/index.ts` (`scheduleDeleteAccountContent`, `scheduleSuspendedAccountDeletion`) — 60s job and the suspended-account timer
4. `src/common/database.ts` (`getPostLikesFromDeletedUsers`) — likes whose liker has no account and no application row
5. `src/common/nerimityCDN.ts` (`deleteImageBatch`) — CDN attachment deletion; response not checked

## Invariants

- Nothing deletes ScheduleAccountContentDelete rows.
- CDN deletion is not awaited in the content jobs and DB rows are deleted first, so a failed CDN call is not retried.
- deleteAccount removes the user cache and disconnects sockets but does not call removeSessions or removeSessionsByUserId.
