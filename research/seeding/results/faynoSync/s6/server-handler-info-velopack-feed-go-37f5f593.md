---
id: server-handler-info-velopack-feed-go-37f5f593
type: file
character: single
title: "server/handler/info/velopack_feed.go"
anchors:
  - {"path":"server/handler/info/velopack_feed.go","symbols":["FindVelopackFeed","authorizeVelopackRead"],"hash":"sha256:dad67a75a6a8","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.476Z
edits: 2
---

# server/handler/info/velopack_feed.go

Denied or unknown app on the feed path returns 200 with {"Assets":[]}, and on .nupkg returns 404; a test asserts both are byte-identical to the unknown-app answer. A load error also yields the empty feed with 200. With localVersion the feed is capped at RequiredIntermediateStep (a different version parser from velopack.CompareVersions); if that lookup errors it logs and serves the uncapped feed. An id query differing from the app name is 404 before any access check.
