---
id: mongod-reports-go-2a2dc8aa
type: file
character: hub
title: "mongod/reports.go"
anchors:
  - {"path":"mongod/reports.go","symbols":["GetReportContextByKey","IncrementReportGroup","IncrementReportGroupDetails","DeleteReportGroup"],"hash":"sha256:047d081a9403","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.477Z
edits: 1
---

# mongod/reports.go

## Facets

- **GetReportContextByKey** — Matches the Bearer value exactly against report_keys.key_value, then joins apps_meta for app_name and the reports flag. No match returns ErrReportKeyNotFound, which the handler maps to 401. The reports flag is returned, not enforced here; the handler answers 403.
- **IncrementReportGroup** — Upserts on app_id plus groupHash with $inc stats.count, and this runs for every status, so muted groups keep counting. A duplicate-key error from a concurrent upsert is retried once. The second UpdateOne reopens only groups whose status is resolved (status set to open, resolvedAt and resolvedBy unset); open and muted groups keep their status.
- **IncrementReportGroupDetails** — Only changes stats.detailsStored and stats.detailsRejected (and updatedAt); it never touches stats.count.
- **DeleteReportGroup** — Deletes the group's report_blobs first, collects their storage.key values, then deletes the group document and returns the collected storage keys to the caller.
