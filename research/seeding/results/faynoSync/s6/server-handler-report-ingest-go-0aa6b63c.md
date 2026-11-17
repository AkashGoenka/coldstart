---
id: server-handler-report-ingest-go-0aa6b63c
type: file
character: single
title: "server/handler/report/ingest.go"
anchors:
  - {"path":"server/handler/report/ingest.go","symbols":["IngestReport","validateIngestRequest","bearerToken"],"hash":"sha256:8d4071ea3a02","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.521Z
edits: 2
---

# server/handler/report/ingest.go

/reports/ingest is outside the JWT middleware; its only auth is the bearer report key (unknown = 401). The group is incremented before details are looked at: invalid details or a failed storeDetailsBlob (e.g. S3_BUCKET_NAME_PRIVATE unset) still leave the group counted, and the latter returns 202 with stored_details=false. Rate limiting runs after field validation, so malformed requests burn no budget. X-Device-ID is not length-capped here, unlike the telemetry path (128 bytes).
