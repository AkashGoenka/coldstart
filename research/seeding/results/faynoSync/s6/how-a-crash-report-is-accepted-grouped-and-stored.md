---
id: how-a-crash-report-is-accepted-grouped-and-stored
type: flow
title: "how a crash report is accepted, grouped and stored"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/ingest.go","hash":"sha256:8d4071ea3a02","head":"ca2f88a4fe38"}
  - {"path":"mongod/reports.go","hash":"sha256:047d081a9403","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/ratelimit.go","hash":"sha256:3aeadf027869","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/blob.go","hash":"sha256:e93bef5ef1c8","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/group_hash.go","hash":"sha256:0dae21edafd3","head":"ca2f88a4fe38"}
  - {"path":"server/handler/report/details.go","hash":"sha256:4c1b4e59bc74","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.372Z
edits: 1
---

# how a crash report is accepted, grouped and stored

A report is accepted on a public route authenticated only by a per-app Bearer report key, and its group is counted BEFORE its optional details are validated and stored, so rejected details still leave the group counted; auth, body validation and rate limiting all run before the group upsert and count nothing. Details are stored still-gzipped in the private bucket and only the newest REPORTS_MAX_BLOBS_PER_GROUP blobs per group are kept.

## Steps

1. `server/server.go` (`StartServer`) — /reports/ingest only when REPORTS_ENABLED, above authMiddleware; /reports/groups routes map list/blobs=Download, PATCH=Edit, DELETE=Delete; /report-keys/* are outside the flag
2. `server/handler/report/ingest.go` (`IngestReport`) — order: key, X-Device-ID, key lookup, per-app enabled, body cap, decode, validation, app name equals key's app, rate limit, group upsert, details
3. `mongod/reports.go` (`IncrementReportGroup`) — upsert by (app_id, groupHash), then a separate write reopens resolved groups
4. `server/handler/report/ratelimit.go` (`checkRateLimits`) — three Redis fixed windows; Redis errors allow the request
5. `server/handler/report/blob.go` (`storeDetailsBlob`, `trimGroupBlobs`) — upload, metadata insert, trim

## Invariants

- The body application.name must equal the key's app (403)
- Group identity includes version and channel
