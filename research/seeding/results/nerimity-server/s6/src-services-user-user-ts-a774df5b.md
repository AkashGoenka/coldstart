---
id: src-services-user-user-ts-a774df5b
type: file
character: single
title: "src/services/User/User.ts"
anchors:
  - {"path":"src/services/User/User.ts","symbols":["isIpBanned","getSuspensionDetails","isEmailSuspended"],"hash":"sha256:b8459d427552","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.937Z
edits: 2
---

# src/services/User/User.ts

isIpBanned and getSuspensionDetails are reads with a delete side effect: an expired bannedIp or suspension row is deleted when read and reported as not banned (isIpBanned wraps the delete in .catch, getSuspensionDetails does not). isEmailSuspended hashes the email string exactly as passed with sha256 and matches only suspension rows with expireAt null, so email blocks cover permanent suspensions and deleted-shadow-banned accounts only.
