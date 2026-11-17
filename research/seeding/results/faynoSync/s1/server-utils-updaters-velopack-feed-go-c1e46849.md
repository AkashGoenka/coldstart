---
id: server-utils-updaters-velopack-feed-go-c1e46849
type: file
character: single
title: "server/utils/updaters/velopack/feed.go"
anchors:
  - {"path":"server/utils/updaters/velopack/feed.go","symbols":["BuildFeed","deltaBaseAvailable","CompareVersions"],"hash":"sha256:39850006ad2c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.960Z
edits: 1
---

# server/utils/updaters/velopack/feed.go

BuildFeed emits a Full asset for each published release, and a Delta only when the next lower version in the sorted list is published and has a Full, so an unpublished middle version drops the delta above it (TestBuildFeedDeltaHoleDropped); a release with no lower version never gets a Delta (TestBuildFeedContiguousChainKeepsDeltas). CompareVersions splits on dots and treats any component that is not a plain integer as 0, so 1.2.0-beta and 1.2.0 compare equal and keep their input order. Release.Intermediate is set by the loaders but BuildFeed never reads it; the intermediate cap is applied by the caller through CapAtVersion.
