---
id: server-handler-info-telemetry-beacon-go-2dbf39e4
type: file
character: single
title: "server/handler/info/telemetry_beacon.go"
anchors:
  - {"path":"server/handler/info/telemetry_beacon.go","symbols":["TelemetryBeacon","beaconHasUpdate"],"hash":"sha256:172e4be9b8bd","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.640Z
edits: 1
---

# server/handler/info/telemetry_beacon.go

TelemetryBeacon answers 204 for every rejection (no X-Device-ID, invalid owner/app/channel/platform/arch or version format, tuple not in the allow-list, allow-list not loaded), so a caller cannot tell whether it was counted. The route has no authMiddleware, and the device ID is used as sent: unlike report/ingest.go, it is not TrimSpace'd. is_latest goes through beaconHasUpdate (strconv.ParseBool); a missing or unparseable value skips the latest/outdated sets, but the request, unique-client, version, platform, architecture and channel counts still record. The ENABLE_TELEMETRY 403 comes from telemetryMiddleware in server.go, not from this handler.
