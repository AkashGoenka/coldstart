---
id: no-test-covers-channel-or-role-permission-refusals
type: lesson
kind: absence
title: "no test covers channel or role permission refusals"
scope: {"terms":["permission","not allowed","is private","channelPermissions","memberHasRolePermission"]}
status: active
updated: 2026-11-17T03:25:07.355Z
edits: 1
---

# no test covers channel or role permission refusals

Searched tests/ for permission, 'not allowed' and 'is private'; nothing matches. The specs present are tests/servers/createServer, createServerMessage and joinServer, and none asserts a channel-level or role-level 403, so the flow in this area is only checked by reading code.

## Scope (absence — freshness = re-run this search)

- terms: `permission`, `not allowed`, `is private`, `channelPermissions`, `memberHasRolePermission`
