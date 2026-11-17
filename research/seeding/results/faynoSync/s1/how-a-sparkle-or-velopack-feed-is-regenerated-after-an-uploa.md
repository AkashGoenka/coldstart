---
id: how-a-sparkle-or-velopack-feed-is-regenerated-after-an-uploa
type: flow
title: "how a sparkle or velopack feed is regenerated after an upload, version edit or delete"
anchors:
  - {"path":"server/handler/create/finalize.go","hash":"sha256:1d692d140d95","head":"ca2f88a4fe38"}
  - {"path":"server/handler/update/update.go","hash":"sha256:40435451fd8b","head":"ca2f88a4fe38"}
  - {"path":"server/handler/delete/delete.go","hash":"sha256:048ea1649e26","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/feed_tuples.go","hash":"sha256:57ddedcc139b","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_materialize.go","hash":"sha256:15f1d92053ec","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/sparkle_materialize.go","hash":"sha256:e7f9574f82b0","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_load.go","hash":"sha256:126845697fa7","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/sparkle_load.go","hash":"sha256:a77c7f59aea8","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/feed.go","hash":"sha256:39850006ad2c","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/sparkle/appcast.go","hash":"sha256:9a44ae9c21de","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/feedkey.go","hash":"sha256:eff40962c20f","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/sparkle/feedkey.go","hash":"sha256:14c49d835fe0","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/updaters.go","hash":"sha256:ddfdb868efcf","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.918Z
edits: 1
---

# how a sparkle or velopack feed is regenerated after an upload, version edit or delete

A publish, version edit or delete rebuilds the sparkle appcast or velopack feed only for the (channel, platform, arch) tuples it touched, and falls back to every feed of the app when the tuple list is empty or cannot be derived. The Materialize*ForApp and *ForTuples entry points log storage and build errors and return nothing, so the calling handlers never see a failed write. Private apps are skipped in the *Feeds functions before any read or write, so no public object is created or removed for them.

## Steps

1. `server/handler/create/finalize.go` (`FinalizeUpload`) — after an upload, derives the single tuple from the request with TupleFromContext and calls the velopack or sparkle ForTuplesOrFull variant chosen by the updater string
2. `server/handler/update/update.go` (`UpdateSpecificApp`) — after a version-level edit, takes every tuple the version has artifacts in (VelopackVersionTuples / SparkleVersionTuples); a derivation error leaves the tuple list nil and forces a full app regeneration
3. `server/handler/delete/delete.go` (`DeleteSpecificArtifactOfApp`, `DeleteSpecificVersionOfApp`) — deleting one artifact regenerates its tuple via TupleFromContext; deleting versions calls the ForApp (full) variants
4. `server/handler/info/feed_tuples.go` (`TupleFromContext`, `versionTuples`, `VelopackVersionTuples`, `SparkleVersionTuples`) — TupleFromContext returns nil unless channel, platform and arch are all non-empty; versionTuples drops artifacts whose names do not resolve in apps_meta and dedupes the rest
5. `server/handler/info/velopack_materialize.go` (`MaterializeVelopackForTuplesOrFull`, `MaterializeVelopackFeedsForTuples`, `materializeVelopackKeys`, `writeVelopackFeed`) — nil or empty tuples switch to MaterializeVelopackForApp; otherwise each deduped tuple is loaded, built and written; private apps return at the top of the Feeds function
6. `server/handler/info/sparkle_materialize.go` (`MaterializeSparkleForTuplesOrFull`, `MaterializeSparkleFeedsForTuples`, `materializeSparkleKeys`, `writeSparkleFeed`) — same shape as the velopack chain: tuple or full dispatch, then load, build, write per (channel, platform, arch)
7. `server/handler/info/velopack_load.go` (`loadVelopackReleases`) — loads every version of the channel that has a velopack artifact for the platform and arch, and keeps only artifacts typed Full or Delta
8. `server/handler/info/sparkle_load.go` (`loadSparkleReleases`) — same tuple-scoped load for sparkle, producing sparkle.Release values with Full and Deltas
9. `server/utils/updaters/velopack/feed.go` (`BuildFeed`) — turns releases into the Velopack JSON document (published releases only, deltas gated on the base version)
10. `server/utils/updaters/sparkle/appcast.go` (`BuildAppcast`) — turns releases into the RSS/Sparkle XML by re-emitting each stored item and overlaying faynoSync-owned fields
11. `server/utils/updaters/velopack/feedkey.go` (`FeedObjectKey`) — storage key velopack/<owner>/<app>/<platform>/<arch>/releases.<channel>.json
12. `server/utils/updaters/sparkle/feedkey.go` (`AppcastObjectKey`) — storage key sparkle/<owner>/<app>/<platform>/<arch>/appcast.<channel>.xml; platform and arch segments are skipped when empty, and appcast.xml is used when channel is empty
13. `server/utils/updaters/updaters.go` (`BuildS3Key`) — on upload, an uploaded sparkle appcast is stored at AppcastObjectKey, so the materialized write later overwrites that same object

## Invariants

- Private apps produce no storage call of any kind (TestMaterializeSkipsPrivateApps in server/handler/info/private_materialize_test.go uses a storage client that panics on any call).
- Tuple keys are deduplicated per (channel, platform, arch) before writing, in both sparkleKeysFromTuples and velopackKeysFromTuples.
- writeSparkleFeed and writeVelopackFeed skip the upload when the stored object's ETag equals the MD5 of the new bytes, but only when the storage client implements cdnObjectStatClient; otherwise every regeneration re-uploads.
- A Materialize*ForTuples call with a non-empty tuple list touches only those tuples' objects; the full path is the only one that enumerates every (channel, platform, arch) of the app.
