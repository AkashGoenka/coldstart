---
id: server-utils-updaters-velopack-feed-go-c1e46849
type: file
character: single
title: "server/utils/updaters/velopack/feed.go"
anchors:
  - {"path":"server/utils/updaters/velopack/feed.go","symbols":["BuildFeed","deltaBaseAvailable","CompareVersions"],"hash":"sha256:39850006ad2c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.480Z
edits: 2
---

# server/utils/updaters/velopack/feed.go

A Delta is emitted only when deltaBaseAvailable is true, which looks just at the next-lower version in the sorted list: an unpublished version between two published ones removes the delta. CompareVersions Atoi's dot parts and treats unparsable parts as 0, so 1.0.0-beta equals 1.0.0. BuildFeed sets NotesHTML from changelog markdown with HTML escaping off.
