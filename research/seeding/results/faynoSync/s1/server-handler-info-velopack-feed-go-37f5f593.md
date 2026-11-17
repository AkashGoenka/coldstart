---
id: server-handler-info-velopack-feed-go-37f5f593
type: file
character: single
title: "server/handler/info/velopack_feed.go"
anchors:
  - {"path":"server/handler/info/velopack_feed.go","symbols":["FindVelopackFeed","authorizeVelopackRead","latestPublishedVersion"],"hash":"sha256:dad67a75a6a8","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.940Z
edits: 1
---

# server/handler/info/velopack_feed.go

FindVelopackFeed answers from the database, not from storage: a path ending in .nupkg gets a 302 to the stored package link (resolveVelopackPackageLink), and any other path must parse as releases.<channel>.json. A denied feed returns HTTP 200 with {"Assets":[]} while a denied package returns 404, and a load error also returns the empty feed. When localVersion is given, the handler caps the list at the required intermediate step; if that lookup fails it only logs a warning and serves the uncapped list.
