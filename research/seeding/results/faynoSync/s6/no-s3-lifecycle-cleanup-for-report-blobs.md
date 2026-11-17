---
id: no-s3-lifecycle-cleanup-for-report-blobs
type: lesson
kind: absence
title: "no S3 lifecycle cleanup for report blobs"
scope: {"terms":["lifecycle","expiresAt","report_blobs_ttl"]}
status: active
updated: 2026-11-17T03:28:54.572Z
edits: 1
---

# no S3 lifecycle cleanup for report blobs

The report_blobs_ttl Mongo index removes blob metadata only; no code or config in the repo deletes the S3 objects of expired blobs (only trimGroupBlobs and group deletes do).

## Scope (absence — freshness = re-run this search)

- terms: `lifecycle`, `expiresAt`, `report_blobs_ttl`
