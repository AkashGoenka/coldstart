---
id: how-an-upload-or-delete-invalidates-cached-update-responses
type: flow
title: "how an upload or delete invalidates cached update responses and their CDN copies"
anchors:
  - {"path":"server/handler/info/latest.go","hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest_edge.go","hash":"sha256:a050c1a044b8","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/handler/delete/delete.go","hash":"sha256:048ea1649e26","head":"ca2f88a4fe38"}
  - {"path":"server/handler/update/update.go","hash":"sha256:40435451fd8b","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/finalize.go","hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:41.935Z
edits: 1
---

# how an upload or delete invalidates cached update responses and their CDN copies

Two different mechanisms clear the same app: Redis response-cache keys are SCANned and DELeted by owner, app, channel pattern (only when PERFORMANCE_MODE is on), while the CDN copies under responses/<owner>/<app>/ are swept by app prefix and guarded by a per-app counter in Redis (cdn_epoch:<owner>:<app>). The counter is bumped before the sweep, so a CDN publish that read the counter earlier is either skipped before its upload or deleted after it. The latest-version handler in FindLatestVersion, the publish side in latest_edge.go and the writers in upload.go and delete.go all depend on that one counter.

## Steps

1. `server/handler/info/latest.go` (`FindLatestVersion`, `CreateCacheKey`, `CacheKeyPattern`, `cacheResponse`) — reader: returns early on a Redis hit; otherwise captures the CDN epoch (only when access.CdnEdge), computes the response, caches it for 24h and hands it to publishResponseToCDN
2. `server/handler/info/latest_edge.go` (`ReadCDNEpoch`, `BumpCDNEpoch`, `publishResponseToCDN`, `uploadResponseToCDN`) — publish side: runs the upload in a goroutine, re-compares the epoch before and after the upload, and deletes the object it just wrote if the epoch changed
3. `server/handler/create/upload.go` (`InvalidatePublishCaches`, `InvalidateAppCaches`, `InvalidateCache`, `InvalidateCDNResponseCache`) — writer side for uploads: Redis key sweep for one channel, then BumpCDNEpoch and a DeleteObjects sweep of the whole app prefix
4. `server/handler/delete/delete.go` (`DeleteSpecificVersionOfApp`, `DeleteSpecificArtifactOfApp`) — writer side for deletes: calls InvalidateAppCaches with the deleted versions' channels, or with the artifact's channel when the artifact delete reports a change
5. `server/handler/update/update.go` (`InvalidatePublishCaches`) — update handler calls the same InvalidatePublishCaches, so it shares the publish-field gate
6. `server/handler/create/finalize.go` (`InvalidatePublishCaches`) — upload finalize step calls the same InvalidatePublishCaches with the same gate

## Invariants

- The Redis sweep is scoped to one channel of one owner/app; the CDN sweep is scoped to the whole owner/app prefix, across channels.
- Redis invalidation runs only when performanceMode is on and the Redis client is non-nil; the CDN prefix sweep runs whenever S3_BUCKET_NAME_CDN is set, regardless of performanceMode.
- Upload and update invalidate nothing unless the request's publish field is exactly true or false (trimmed, lowercased); the artifact-delete path has no such gate.
- The epoch guard needs Redis: BumpCDNEpoch is a no-op when rdb is nil, and an unreadable epoch makes the post-upload check keep the object rather than delete it.
- On the path where access.CdnEdge is false but checkResult.CdnEdge is true, the epoch captured is empty, so once the counter exists the publish compares unequal and is skipped.
