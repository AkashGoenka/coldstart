---
id: how-checkversion-resolves-the-latest-version-and-builds-the
type: flow
title: "how checkVersion resolves the latest version and builds the per-updater response"
anchors:
  - {"path":"server/utils/validate.go","hash":"sha256:8046aac4b51c","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/access.go","hash":"sha256:d6c6e35a64cc","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest.go","hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
  - {"path":"mongod/check.go","hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/updaters.go","hash":"sha256:ddfdb868efcf","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest_edge.go","hash":"sha256:a050c1a044b8","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/utils/check.go","hash":"sha256:7b5c4e0b5f69","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/tauri.go","hash":"sha256:b241ceb9306a","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/squirrel.go","hash":"sha256:f68b114b97d9","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/electron_builder.go","hash":"sha256:e6a813204471","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/installer.go","hash":"sha256:23a0b1769be0","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.354Z
edits: 1
---

# how checkVersion resolves the latest version and builds the per-updater response

One Mongo lookup result becomes a 204, a 302 or a rebuilt 200 depending only on the updater string, applied after the lookup in updaters.BuildResponse; the lookup does not filter by rollout, which is returned to the client as a field. Rollbacks (client newer than latest) flow through the same branches as updates. Private apps never touch the Redis response cache or the CDN JSON.

## Steps

1. `server/utils/validate.go` (`ValidateParamsLatest`) — resolves platform/updater/arch/channel before the cache key is built
2. `server/handler/info/access.go` (`authorizeReadRequest`, `authorizeRead`) — private-app gate before the Redis cache
3. `server/handler/info/latest.go` (`FindLatestVersion`, `CreateCacheKey`) — cache read (performanceMode, non-private only), CDN epoch capture, lookup, updater response, cache write, CDN publish
4. `mongod/check.go` (`CheckLatestVersion`) — newest published version, required intermediate, or rollback/equal flags
5. `server/utils/updaters/updaters.go` (`BuildResponse`) — per-updater status code and body
6. `server/handler/info/latest_edge.go` (`publishResponseToCDN`) — async epoch-guarded CDN write
7. `server/handler/create/upload.go` (`InvalidateCache`, `InvalidateCDNResponseCache`) — invalidation on publish: Redis scoped to one channel, CDN sweep covers the whole app

## Invariants

- Cache keys use the RESOLVED platform/arch/updater
- The CDN epoch is read before the lookup, so a concurrent upload makes the CDN write drop
- The not-found 200 body is never cached or published
