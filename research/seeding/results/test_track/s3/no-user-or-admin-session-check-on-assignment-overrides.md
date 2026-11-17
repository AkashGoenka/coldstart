---
id: no-user-or-admin-session-check-on-assignment-overrides
type: lesson
kind: absence
title: "no user or admin-session check on assignment overrides"
scope: {"terms":["assignment_override","BROWSER_EXTENSION_SHARED_SECRET","current_user","SharedSecretAuthenticatedApiController"]}
status: active
updated: 2026-11-16T18:24:05.935Z
edits: 1
---

# no user or admin-session check on assignment overrides

Searched app/controllers for authenticate and skip_before_action, and read the override path: the v1 and v2 assignment_overrides controllers inherit only SharedSecretAuthenticatedApiController, their permitted params contain no user or actor id, and ArbitraryAssignmentCreation and BatchArbitraryAssignmentCreation take none. Override writes therefore record no actor. Neither the code nor its comments say why a shared secret was used instead of admin sessions; README.md (around line 68) only says to set BROWSER_EXTENSION_SHARED_SECRET for the Chrome extension.

## Scope (absence — freshness = re-run this search)

- terms: `assignment_override`, `BROWSER_EXTENSION_SHARED_SECRET`, `current_user`, `SharedSecretAuthenticatedApiController`
