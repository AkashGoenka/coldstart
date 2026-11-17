---
id: server-handler-create-finalize-go-7d5f6aec
type: file
character: single
title: "server/handler/create/finalize.go"
anchors:
  - {"path":"server/handler/create/finalize.go","symbols":["FinalizeUpload","NotifySlackForApp"],"hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.452Z
edits: 2
---

# server/handler/create/finalize.go

FinalizeUpload is the shared tail of both multipart and presigned completion: InvalidatePublishCaches first, then for velopack CopyVelopackInstallersToDefault and MaterializeVelopackForTuplesOrFull, for sparkle MaterializeSparkleForTuplesOrFull. NotifySlackForApp is a no-op unless SLACK_ENABLE and then re-reads the version from the DB in a 10s goroutine, so the message reflects the stored record.
