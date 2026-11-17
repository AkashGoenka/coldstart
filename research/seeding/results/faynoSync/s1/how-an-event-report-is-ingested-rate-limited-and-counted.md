---
id: how-an-event-report-is-ingested-rate-limited-and-counted
type: flow
title: "how an event report is ingested, rate-limited and counted"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/ingest.go","hash":"sha256:8d4071ea3a02","head":"ca2f88a4fe38"}
  - {"path":"mongod/reports.go","hash":"sha256:047d081a9403","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/group_hash.go","hash":"sha256:0dae21edafd3","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/ratelimit.go","hash":"sha256:3aeadf027869","head":"ca2f88a4fe38"}
  - {"path":"mongod/report_keys.go","hash":"sha256:f04b03980f32","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.450Z
edits: 1
---

# how an event report is ingested, rate-limited and counted

Ingest authenticates with the per-app report key (Bearer, matched against report_keys.key_value), not the JWT, and a rate-limited request returns 429 before report_groups is written. The group identity is a SHA-256 over app name, version, channel, platform, arch, event type and reason. Optional details are stored after the base count is written, so a details failure never un-counts the report.

## Steps

1. `server/server.go` (`IngestReport`) — POST /reports/ingest is registered only when REPORTS_ENABLED is set, and it is declared before router.Use(authMiddleware), so the JWT middleware never runs on it.
2. `server/handler/report/ingest.go` (`IngestReport`, `bearerToken`) — Handler: Bearer parse, X-Device-ID check, key resolution, reports flag, body cap, decode, field validation, group hash, rate limits, group upsert, optional details, then 202.
3. `mongod/reports.go` (`GetReportContextByKey`) — Resolves the key by exact match on report_keys.key_value and joins apps_meta for app_name and the reports flag.
4. `server/handler/report/group_hash.go` (`buildGroupHash`) — Computes the groupHash that keys report_groups and the device and group rate-limit counters.
5. `server/handler/report/ratelimit.go` (`checkRateLimits`) — Three Redis fixed-window counters (key per minute, device plus group per hour, group per minute); any Redis error allows the request.
6. `mongod/reports.go` (`IncrementReportGroup`, `IncrementReportGroupDetails`) — Upserts report_groups on app_id plus groupHash with stats.count +1, reopens resolved groups, and records stored or rejected details counts.

## Invariants

- A request that gets 429 from checkRateLimits never reaches IncrementReportGroup, so it is absent from stats.count.
- Rate-limit INCRs run before each limit is compared, so a request rejected by a later window has already consumed the earlier windows' counts.
- Application.name in the body must equal the key's app name (403); that check runs after the field-format checks.
- The base count is written before details are decoded; rejected details do not decrement stats.count.
- Version and channel are part of group identity, so the same failure on two versions is two report_groups documents.
