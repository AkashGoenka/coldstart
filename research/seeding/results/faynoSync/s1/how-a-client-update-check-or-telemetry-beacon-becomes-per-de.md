---
id: how-a-client-update-check-or-telemetry-beacon-becomes-per-de
type: flow
title: "how a client update check or telemetry beacon becomes per-device Redis counters, and how GET /telemetry reads them back"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/telemetry_beacon.go","hash":"sha256:172e4be9b8bd","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/telemetry_allowlist.go","hash":"sha256:c878606ad638","head":"ca2f88a4fe38"}
  - {"path":"server/handler/handler.go","hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest.go","hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/telemetry.go","hash":"sha256:a7a78a1319c6","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/telemetry.lua","hash":"sha256:cfbaab3cd547","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.612Z
edits: 1
---

# how a client update check or telemetry beacon becomes per-device Redis counters, and how GET /telemetry reads them back

The beacon (GET /telemetry/beacon) and /checkVersion write the same per-device Redis sets through one function, trackClientTelemetryWithLatest, but only the beacon is gated by the Mongo-built allow-list, and GET /telemetry reads the sets back through one Lua script. ENABLE_TELEMETRY is checked in two different places: telemetryMiddleware in server.go answers the beacon with 403, while /checkVersion skips the write inside logStatsToRedis and its response is unchanged. Until the allow-list has loaded once, every beacon is dropped with a 204.

## Steps

1. `server/server.go` (`telemetryMiddleware`) — registers GET /telemetry/beacon before authMiddleware with telemetryMiddleware, and GET /telemetry after it with both; telemetryMiddleware returns 403 JSON when ENABLE_TELEMETRY is false
2. `server/handler/info/telemetry_beacon.go` (`TelemetryBeacon`) — beacon entry: needs X-Device-ID and valid owner/app/channel/platform/arch (version only format-checked when set), then the allow-list Valid check; every rejection is a 204
3. `server/handler/info/telemetry_allowlist.go` (`LoadTelemetryAllowList`, `BuildTelemetryAllowListFromDB`) — the process-wide allow-list the beacon checks; nil until the first successful build from Mongo
4. `server/handler/handler.go` (`reloadTelemetryAllowListAfterSuccess`, `reloadTelemetryAllowList`) — rebuilds the allow-list after successful app, channel, platform, architecture and version writes and once at handler init
5. `server/handler/info/latest.go` (`FindLatestVersion`, `logStatsToRedis`) — the /checkVersion write: called on the PERFORMANCE_MODE cache-hit branch and after CheckLatestVersion succeeds, with the device ID header; logStatsToRedis re-checks ENABLE_TELEMETRY and has no allow-list check
6. `server/handler/info/latest.go` (`trackClientTelemetryWithLatest`) — shared writer: rejects an empty or over-128-byte device ID, then bumps the day's request counter and SADDs the device into unique, channel, platform, architecture and version sets, moving it out of the other sets for that day, and into clients_using_latest_version or clients_outdated
7. `server/handler/info/telemetry.go` (`GetTelemetry`, `mergeResults`) — the read: resolves the admin owner, builds the UTC date range, runs telemetryScript once for all apps or once per apps filter value, and merges the results
8. `server/handler/info/telemetry.lua` (`get_filtered_clients`) — aggregates the sets for the date range in one EVAL: app discovery, per-client filters, period and per-day unions

## Invariants

- A device sits in at most one channel and one version set per app per UTC day: each write removes it from the other known channel (or version) sets first (TestTelemetry_ChannelSwitch_CountsDeviceOnceSameDay covers channels).
- Keys are scoped by owner: stats:<owner>:<app>:... On GET /telemetry the admin's keys are read, also for a team user, because the handler resolves the owner with ResolveRequestOwner.
- Every telemetry key gets a 30-day TTL, refreshed on each write, so a quiet app's daily sets age out.
- The /checkVersion counter runs only after authorizeReadRequest and CheckLatestVersion succeed; a 400 from CheckLatestVersion is not counted.
- The beacon counts only owner/app/channel/platform/arch tuples present in the allow-list, and the allow-list is built from published artifacts only (the $match on published, then $unwind on artifacts).
