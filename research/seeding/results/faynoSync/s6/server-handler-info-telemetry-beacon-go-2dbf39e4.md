---
id: server-handler-info-telemetry-beacon-go-2dbf39e4
type: file
character: single
title: "server/handler/info/telemetry_beacon.go"
anchors:
  - {"path":"server/handler/info/telemetry_beacon.go","symbols":["TelemetryBeacon","validTelemetryBeaconParams"],"hash":"sha256:172e4be9b8bd","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.524Z
edits: 2
---

# server/handler/info/telemetry_beacon.go

Every outcome is 204 with no body (missing X-Device-ID, invalid params, allow-list not loaded, tuple not allow-listed, success), so a caller cannot tell a dropped beacon from a counted one. The allow-list check uses owner/app/channel/platform/arch only; version is syntax-checked but never gated. A missing or unparsable is_latest skips the latest/outdated sets while request and usage sets still count.
