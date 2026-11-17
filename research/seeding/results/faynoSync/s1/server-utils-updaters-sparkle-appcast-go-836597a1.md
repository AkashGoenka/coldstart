---
id: server-utils-updaters-sparkle-appcast-go-836597a1
type: file
character: single
title: "server/utils/updaters/sparkle/appcast.go"
anchors:
  - {"path":"server/utils/updaters/sparkle/appcast.go","symbols":["BuildAppcast","rewriteEnclosureURLs","overlayCritical","overlayChangelog","releaseSortKey"],"hash":"sha256:9a44ae9c21de","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.951Z
edits: 1
---

# server/utils/updaters/sparkle/appcast.go

BuildAppcast re-emits each published release's stored RawItem XML (the item from the uploaded appcast) and overlays only the fields faynoSync owns: enclosure URLs are rewritten by file basename to the stored links with signature and length untouched, criticalUpdate is kept as uploaded when critical and added bare when absent, removed when not critical, description is replaced only when the changelog renders non-empty, pubDate comes from the version's Updated_at, and sparkle:channel is removed. Items are sorted by sparkle:version (CFBundleVersion) when present, otherwise by the release version. Items without a Full asset are skipped, and deltas appear only inside an item's enclosures, never as items of their own.
