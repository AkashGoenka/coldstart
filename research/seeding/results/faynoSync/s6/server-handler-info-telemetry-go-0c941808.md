---
id: server-handler-info-telemetry-go-0c941808
type: file
character: single
title: "server/handler/info/telemetry.go"
anchors:
  - {"path":"server/handler/info/telemetry.go","symbols":["GetTelemetry","mergeResults"],"hash":"sha256:a7a78a1319c6","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.531Z
edits: 2
---

# server/handler/info/telemetry.go

GetTelemetry refuses fns_ requests with 403 (TestTelemetry_APIToken_Forbidden); team users read their admin's stats via ResolveRequestOwner. range=week yields 8 dates, month 31, and when range is set the date param is ignored. With apps= filters each app runs the Lua script separately and a Lua error skips that app but still returns 200 (the all-apps path returns 500); a device active in two selected apps is counted once per app. telemetry.lua discovers apps/filters with KEYS over the keyspace on every call.
