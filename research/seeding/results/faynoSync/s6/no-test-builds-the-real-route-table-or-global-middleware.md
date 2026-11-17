---
id: no-test-builds-the-real-route-table-or-global-middleware
type: lesson
kind: absence
title: "no test builds the real route table or global middleware"
scope: {"terms":["StartServer","corsMiddleware","telemetryMiddleware"]}
status: active
updated: 2026-11-17T03:28:54.537Z
edits: 1
---

# no test builds the real route table or global middleware

StartServer, corsMiddleware and telemetryMiddleware are referenced by no _test.go file; root faynoSync_test.go builds its own small gin routers, so nothing pins which routes are public or authenticated.

## Scope (absence — freshness = re-run this search)

- terms: `StartServer`, `corsMiddleware`, `telemetryMiddleware`
