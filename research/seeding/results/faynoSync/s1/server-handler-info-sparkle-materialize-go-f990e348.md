---
id: server-handler-info-sparkle-materialize-go-f990e348
type: file
character: single
title: "server/handler/info/sparkle_materialize.go"
anchors:
  - {"path":"server/handler/info/sparkle_materialize.go","symbols":["MaterializeSparkleForTuplesOrFull","materializeSparkleKeys","writeSparkleFeed","discoverSparkleTuples"],"hash":"sha256:e7f9574f82b0","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.933Z
edits: 1
---

# server/handler/info/sparkle_materialize.go

Sparkle appcasts are built from database rows, never from the uploaded file: materializeSparkleKeys loads each (channel, platform, arch) with loadSparkleReleases, builds it with sparkle.BuildAppcast and writes it to sparkle/<owner>/<app>/<platform>/<arch>/appcast.<channel>.xml. The exported Materialize*ForApp and *ForTuples functions log every error and return nothing, so the upload, edit and delete handlers that call them cannot see a failed write. Private apps return at the top of each *Feeds function before discovery, so nothing is written for them. writeSparkleFeed skips the upload when the existing object's ETag matches the MD5 of the new bytes, but only if the storage client implements cdnObjectStatClient.
