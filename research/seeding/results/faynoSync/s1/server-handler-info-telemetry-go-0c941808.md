---
id: server-handler-info-telemetry-go-0c941808
type: file
character: hub
title: "server/handler/info/telemetry.go"
anchors:
  - {"path":"server/handler/info/telemetry.go","symbols":["GetTelemetry","mergeResults"],"hash":"sha256:a7a78a1319c6","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.634Z
edits: 1
---

# server/handler/info/telemetry.go

## Facets

- **GetTelemetry** — With apps=a,b the handler runs the Lua script once per app, and a failed call is logged and skipped, so the response is 200 with partial data. Without apps, one call covers all apps, and a Lua error returns 500 'Failed to fetch telemetry data'.
- **mergeResults** — Per-app results are summed, so on the apps-filtered path a device active in two apps is counted twice in summary.unique_clients and in the per-version, platform, architecture and channel totals. The unfiltered call dedupes across apps inside the Lua script, so the same question with and without apps can give different unique_clients. total_active_apps is assigned, not summed, so the filtered response carries the value from the last app's call only.
