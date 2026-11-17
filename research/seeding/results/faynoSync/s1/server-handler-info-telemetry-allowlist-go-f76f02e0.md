---
id: server-handler-info-telemetry-allowlist-go-f76f02e0
type: file
character: single
title: "server/handler/info/telemetry_allowlist.go"
anchors:
  - {"path":"server/handler/info/telemetry_allowlist.go","symbols":["BuildTelemetryAllowListFromDB","ReloadTelemetryAllowList","Valid"],"hash":"sha256:c878606ad638","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.648Z
edits: 1
---

# server/handler/info/telemetry_allowlist.go

The allow-list is one process-wide atomic.Pointer built by a Mongo aggregate over the apps collection: published documents, one row per artifact, with app, channel, platform and arch names joined from apps_meta, and rows whose lookups miss are dropped by the $unwind stages. ReloadTelemetryAllowList swaps the pointer only after a successful build, so a failed rebuild keeps the previous list; with a nil database it returns without swapping. Before the first successful load LoadTelemetryAllowList returns nil, and the beacon then drops every request. Valid checks owner, app, channel, platform and arch but never version, even though Add collects versions.
