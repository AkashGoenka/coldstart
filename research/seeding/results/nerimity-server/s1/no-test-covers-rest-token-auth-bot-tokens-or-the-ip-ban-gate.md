---
id: no-test-covers-rest-token-auth-bot-tokens-or-the-ip-ban-gate
type: lesson
kind: absence
title: "no test covers REST token auth, bot tokens or the IP-ban gate"
scope: {"terms":["IP banned","Bots are not allowed","bot token","authenticateUser","getBotToken"]}
status: active
updated: 2026-11-17T03:24:27.821Z
edits: 1
---

# no test covers REST token auth, bot tokens or the IP-ban gate

Searched tests/ for the response strings 'IP banned', 'Bots are not allowed' and for 'bot token'. No match. tests/ contains helpers plus users/, servers/ and related specs, and none asserts the authenticate middleware, authenticateUser or getBotToken behavior. Changes to this path have no spec to catch regressions.

## Scope (absence — freshness = re-run this search)

- terms: `IP banned`, `Bots are not allowed`, `bot token`, `authenticateUser`, `getBotToken`
