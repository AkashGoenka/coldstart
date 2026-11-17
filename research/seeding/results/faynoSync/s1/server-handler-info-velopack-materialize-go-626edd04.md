---
id: server-handler-info-velopack-materialize-go-626edd04
type: file
character: single
title: "server/handler/info/velopack_materialize.go"
anchors:
  - {"path":"server/handler/info/velopack_materialize.go","symbols":["MaterializeVelopackForTuplesOrFull","materializeVelopackKeys","writeVelopackFeed","velopackNotesForVersion"],"hash":"sha256:15f1d92053ec","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.937Z
edits: 1
---

# server/handler/info/velopack_materialize.go

Velopack feeds are written to velopack/<owner>/<app>/<platform>/<arch>/releases.<channel>.json (velopack.FeedObjectKey) with a JSON content type. The object has the same path shape as the /velopack route, but that route rebuilds from the database and never reads this object, and only the route applies the localVersion cap, so the static file lists every published release. velopackNotesForVersion is defined here and is also the changelog source for Sparkle (sparkle_load.go calls it), so changing it changes Sparkle appcast descriptions too. Error handling matches the Sparkle path: the public entry points log and return nothing, and private apps are skipped in the Feeds function.
