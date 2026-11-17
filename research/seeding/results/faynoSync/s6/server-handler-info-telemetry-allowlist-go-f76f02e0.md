---
id: server-handler-info-telemetry-allowlist-go-f76f02e0
type: file
character: single
title: "server/handler/info/telemetry_allowlist.go"
anchors:
  - {"path":"server/handler/info/telemetry_allowlist.go","symbols":["TelemetryAllowList","BuildTelemetryAllowListFromDB","ReloadTelemetryAllowList"],"hash":"sha256:c878606ad638","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.527Z
edits: 2
---

# server/handler/info/telemetry_allowlist.go

The allow-list is a process-global atomic pointer built from published apps (unwind artifacts, $lookup of names); unpublished apps are excluded. Until ReloadTelemetryAllowList stores a value the beacon drops everything. It is reloaded only in this process after successful mutating handlers (handler.go), with no timer.
