---
id: no-login-time-suspension-or-ip-ban-check
type: lesson
kind: absence
title: "no login-time suspension or IP-ban check"
scope: {"terms":["login","getSuspensionDetails","isIpBanned","suspended"]}
status: active
updated: 2026-11-17T03:29:05.229Z
edits: 1
---

# no login-time suspension or IP-ban check

login.ts and the login functions in UserAuthentication.ts never call getSuspensionDetails or isIpBanned; a suspended or IP-banned user can obtain a token. The checks run when the token is used, in UserCache.authenticateUser. Registration does check IP ban, suspended email hash and email blacklist.

## Scope (absence — freshness = re-run this search)

- terms: `login`, `getSuspensionDetails`, `isIpBanned`, `suspended`
