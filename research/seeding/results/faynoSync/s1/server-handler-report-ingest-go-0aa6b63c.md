---
id: server-handler-report-ingest-go-0aa6b63c
type: file
character: single
title: "server/handler/report/ingest.go"
anchors:
  - {"path":"server/handler/report/ingest.go","symbols":["IngestReport","validateIngestRequest"],"hash":"sha256:8d4071ea3a02","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.463Z
edits: 1
---

# server/handler/report/ingest.go

The order of checks is the contract: a missing Bearer or missing X-Device-ID is 401 or 400 before any Mongo lookup, an unknown key is 401, and reports disabled for the app is 403. Body over REPORTS_MAX_BODY_BYTES (default 262144) is 413, and field-format errors are 400 and run before the application.name-vs-key check, which is 403. A details payload rejected by decodeAndValidateDetails returns its 4xx after stats.count was already incremented. If storeDetailsBlob returns false (for example S3_BUCKET_NAME_PRIVATE is unset), the request is counted as a rejected detail but still gets 202 with stored_details false.
