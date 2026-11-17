---
id: server-handler-info-latest-go-64564a19
type: file
character: single
title: "server/handler/info/latest.go"
anchors:
  - {"path":"server/handler/info/latest.go","symbols":["FindLatestVersion","FetchLatestVersionOfApp","CreateCacheKey","buildSquirrelReleasesFeed","logStatsToRedis"],"hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.431Z
edits: 2
---

# server/handler/info/latest.go

Redis response cache is used only when performanceMode && rdb != nil && !access.Private, on both /checkVersion and /apps/latest; the key is built after ValidateParamsLatest so it holds the resolved platform/arch/updater, and entries live 24h. The not-found 200 body ({update_available:false, error:'Not found'}) and single-URL /apps/latest redirects return before cacheResponse. `rollout` is added to the response after updaters.BuildResponse and only when RolloutPercent < 100. A cache hit on /checkVersion still calls logStatsToRedis, a hit on /apps/latest does not. The squirrel RELEASES feed is built only for public apps; any failure in buildSquirrelReleasesFeed falls back to the plain 302. The CDN publish gets the pre-feed response map.
