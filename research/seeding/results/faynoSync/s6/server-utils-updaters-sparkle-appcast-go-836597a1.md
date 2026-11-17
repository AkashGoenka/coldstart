---
id: server-utils-updaters-sparkle-appcast-go-836597a1
type: file
character: single
title: "server/utils/updaters/sparkle/appcast.go"
anchors:
  - {"path":"server/utils/updaters/sparkle/appcast.go","symbols":["BuildAppcast","overlayCritical","overlayChangelog","rewriteEnclosureURLs"],"hash":"sha256:9a44ae9c21de","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.483Z
edits: 2
---

# server/utils/updaters/sparkle/appcast.go

BuildAppcast emits an item only for releases that are Published, have a Full asset and a non-empty RawItem, so a delta-only release disappears. The item body is the RawItem stored at upload; edits are enclosure url rewrite (by basename; edSignature and length untouched), critical, changelog (only if rendered HTML non-empty), pubDate. Ordering uses Full.Meta.SparkleVersion (build number) when present, so it sorts by sparkle:version, not display version. No route in server.go serves appcasts; they exist only as bucket objects.
