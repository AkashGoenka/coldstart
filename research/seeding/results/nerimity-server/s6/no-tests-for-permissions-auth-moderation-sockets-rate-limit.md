---
id: no-tests-for-permissions-auth-moderation-sockets-rate-limit
type: lesson
kind: absence
title: "no tests for permissions, auth, moderation, sockets, rate limit or account deletion"
scope: {"terms":["tests","permission","socket","suspend","deleteAccount","rate limit"]}
status: active
updated: 2026-11-17T03:29:05.222Z
edits: 1
---

# no tests for permissions, auth, moderation, sockets, rate limit or account deletion

The only test files are tests/users (registerUser, confirmUserEmail) and tests/servers (createServer, joinServer, createServerMessage). Searched tests/ for permission, ROLE_PERMISSIONS, 403, socket, suspend, scheduled, deleteAccount and auth error strings; no matches. createServerMessage.test.ts exercises the create_message 429 with test_enable_rate_limit.

## Scope (absence — freshness = re-run this search)

- terms: `tests`, `permission`, `socket`, `suspend`, `deleteAccount`, `rate limit`
