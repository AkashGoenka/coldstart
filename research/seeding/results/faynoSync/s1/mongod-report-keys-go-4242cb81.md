---
id: mongod-report-keys-go-4242cb81
type: file
character: single
title: "mongod/report_keys.go"
anchors:
  - {"path":"mongod/report_keys.go","symbols":["CreateReportKey","RegenerateReportKey"],"hash":"sha256:f04b03980f32","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.481Z
edits: 1
---

# mongod/report_keys.go

One report key per app is enforced by the unique index report_keys_unique_app_id, created in mongod/migrations/20260519111000_create_report_keys_indexes.up.json; CreateReportKey maps the duplicate-key error (code 11000) to 'report key for this app already exists'. Create and regenerate both go through GetAppByID, so team users need apps Edit permission and the app in their allowed list, and both refuse apps with reports disabled. RegenerateReportKey overwrites key_value in place on the same document, so the old key stops resolving immediately (401 on ingest).
