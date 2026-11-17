---
id: no-per-request-telemetry-rate-limit-or-auth-on-the-beacon
type: lesson
kind: absence
title: "no per-request telemetry rate limit or auth on the beacon"
scope: {"terms":["telemetry beacon","rate limit","X-Device-ID","telemetryMiddleware"]}
status: active
updated: 2026-11-17T03:26:57.678Z
edits: 1
---

# no per-request telemetry rate limit or auth on the beacon

Searched server/handler/info/telemetry_beacon.go, server/handler/info/telemetry_allowlist.go and the telemetry routes in server/server.go for a rate limiter, a token, or a signature check on GET /telemetry/beacon. The beacon is declared before authMiddleware, and its only gates are telemetryMiddleware (ENABLE_TELEMETRY), the parameter validation and the allow-list tuple check; the device ID is not authenticated.

## Scope (absence — freshness = re-run this search)

- terms: `telemetry beacon`, `rate limit`, `X-Device-ID`, `telemetryMiddleware`
