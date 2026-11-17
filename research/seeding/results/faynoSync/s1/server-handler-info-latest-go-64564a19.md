---
id: server-handler-info-latest-go-64564a19
type: file
character: hub
title: "server/handler/info/latest.go"
anchors:
  - {"path":"server/handler/info/latest.go","symbols":["FindLatestVersion","maybeSquirrelReleasesFeed","CreateCacheKey","CacheKeyPattern","cacheResponse","FetchLatestVersionOfApp","logStatsToRedis","trackClientTelemetryWithLatest"],"hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:57.672Z
edits: 4
---

# server/handler/info/latest.go

The access gate (authorizeReadRequest) runs before the Redis lookup in FindLatestVersion and FetchLatestVersionOfApp. The cache is used only when performanceMode is on, the Redis client is non-nil and access.Private is false, so a private app's response is never read from or written to the cache. Cached entries are keyed by owner, app, version, channel, platform, arch, updater and package, and live 24 hours.

## Facets

- **CreateCacheKey** — The Redis key always starts with owner, app_name, version, channel, platform and arch, values are query-escaped, and updater and package are appended only when non-empty. Tests TestCreateCacheKeyIsScopedByOwner and TestCreateCacheKeyCannotBeForgedThroughOwner (info/cache_key_test.go) cover the owner scoping.
- **CacheKeyPattern** — Builds the SCAN glob used for invalidation: owner, app_name and channel are exact, version, platform and arch are wildcards, so one channel's keys are dropped in one sweep and other channels are not matched.
- **cacheResponse** — Redis entries expire after 24 hours (time.Hour*24); the cached body is a CachedResponse with the HTTP status, content type and has_update flag.
- **FindLatestVersion** — The Redis response cache is read and written only when performanceMode is on, Redis is non-nil and the app is not private. A cache hit returns before the CDN epoch is read or any CDN publish happens. The epoch is captured only when access.CdnEdge is true, but the publish is gated on checkResult.CdnEdge, which is a separate read (CheckLatestVersion).
- **logStatsToRedis** — The update-check telemetry gate is viper ENABLE_TELEMETRY inside this function. FindLatestVersion calls it on the cache-hit branch (with the cached has_update) and on the miss branch after CheckLatestVersion succeeds (with checkResult.Found), so a not-found 200 response is counted too. There is no allow-list check on this path.
- **trackClientTelemetryWithLatest** — Drops an empty device ID or one over 128 bytes before any write, so an oversized ID does not bump the request counter either (TestTelemetryBeacon_LongDeviceID_NotStoredRaw and TestCheckVersionTelemetry_LongDeviceID_NotStoredRaw). It then increments requests:<day>, SADDs unique_clients:<day>, and for channel, platform, arch and version SREMs the device from the other known sets for that day before SADDing it into the current one. A device's latest/outdated membership flips with hasUpdate, and nothing is written when latest state is unknown. known_versions is a 30-day set of every version seen, not a per-day set.
