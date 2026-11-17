---
id: how-velopack-and-sparkle-feeds-are-parsed-at-upload-material
type: flow
title: "how velopack and sparkle feeds are parsed at upload, materialized and served"
anchors:
  - {"path":"server/handler/create/upload.go","hash":"sha256:a2fa631e8640","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/finalize.go","hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/feed_tuples.go","hash":"sha256:57ddedcc139b","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_load.go","hash":"sha256:126845697fa7","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/feed.go","hash":"sha256:39850006ad2c","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_feed.go","hash":"sha256:dad67a75a6a8","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/sparkle/appcast.go","hash":"sha256:9a44ae9c21de","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/filter.go","hash":"sha256:c4686f7c179a","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_materialize.go","hash":"sha256:15f1d92053ec","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/sparkle_materialize.go","hash":"sha256:e7f9574f82b0","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.358Z
edits: 1
---

# how velopack and sparkle feeds are parsed at upload, materialized and served

The same velopack.BuildFeed over loadVelopackReleases produces both the stored releases.<channel>.json object and the body of GET /velopack/:owner/:app/:platform/:arch/*feed; only the request path adds localVersion capping and the private gate, and private apps never get a materialized object. Sparkle has no serving route: its appcast exists only as the object materializeSparkleKeys writes to the bucket. Upload, edit and delete each re-materialize only the affected (channel, platform, arch) tuples.

## Steps

1. `server/handler/create/upload.go` (`ParseVelopackFeed`, `ParseSparkleAppcast`) — feed files found by name (releases.*.json / appcast*.xml); parsed meta goes in ctxQueryMap; sparkle archives are checked against the appcast here, before storage
2. `server/handler/create/finalize.go` (`MaterializeVelopackForTuplesOrFull`) — after upload, regenerates the uploaded tuple, or the whole app when the tuple is empty
3. `server/handler/info/feed_tuples.go` (`skipPrivateMaterialization`, `versionTuples`) — private apps are a silent no-op
4. `server/handler/info/velopack_load.go` (`loadVelopackReleases`) — builds Full/Delta assets from apps collection
5. `server/utils/updaters/velopack/feed.go` (`BuildFeed`) — renders Assets JSON
6. `server/handler/info/velopack_feed.go` (`FindVelopackFeed`) — request path: .nupkg 302s to stored link; feed branch applies the private gate and CapAtVersion

## Invariants

- A velopack feed never contains download URLs; packages are fetched by FileName through the .nupkg route
- Denied or unknown app returns the same empty-feed 200 / 404 so denial is indistinguishable from absence
