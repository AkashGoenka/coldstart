---
id: server-handler-info-telemetry-lua-d8e42768
type: file
character: single
title: "server/handler/info/telemetry.lua"
anchors:
  - {"path":"server/handler/info/telemetry.lua","symbols":["get_filtered_clients"],"hash":"sha256:cfbaab3cd547","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.627Z
edits: 1
---

# server/handler/info/telemetry.lua

Every aggregate is a set union, not a sum: the period unique, latest, outdated, version, platform, architecture and channel sets are merged across the whole date range and all apps in one call before counting, so result.unique_clients counts each device once per call, while daily_stats dedupes only within its day. With app_name '*' the app list comes from KEYS on 'stats:<admin>:*:requests:<date>' for each date, and the platform, architecture and channel breakdowns also run KEYS per app per date. Filters are AND across the three dimensions and OR within one (an empty list matches everything), checked per client with SISMEMBER on that date's channel, platform and arch sets. Debug mode (ARGV 7 equal to 'true') writes debug:* keys with SET ... EX 300 and nothing else.
