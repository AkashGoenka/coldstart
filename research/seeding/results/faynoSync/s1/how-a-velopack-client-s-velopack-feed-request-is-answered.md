---
id: how-a-velopack-client-s-velopack-feed-request-is-answered
type: flow
title: "how a velopack client's /velopack feed request is answered"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_feed.go","hash":"sha256:dad67a75a6a8","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_load.go","hash":"sha256:126845697fa7","head":"ca2f88a4fe38"}
  - {"path":"mongod/velopack.go","hash":"sha256:0de2531ba191","head":"ca2f88a4fe38"}
  - {"path":"mongod/check.go","hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/filter.go","hash":"sha256:c4686f7c179a","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/velopack/feed.go","hash":"sha256:39850006ad2c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.929Z
edits: 1
---

# how a velopack client's /velopack feed request is answered

GET /velopack/:owner/:app/:platform/:arch/*feed is answered live from the database and never reads the static releases.<channel>.json object that the materializer writes. The route is registered before router.Use(authMiddleware) at server/server.go:123, so the handler's own authorizeVelopackRead is the gate for it. The static object and this response use the same BuildFeed output, except that only this path applies the localVersion intermediate cap.

## Steps

1. `server/server.go` (`FindVelopackFeed`) — registers the route outside the later authMiddleware group
2. `server/handler/info/velopack_feed.go` (`FindVelopackFeed`, `authorizeVelopackRead`, `parseVelopackChannel`) — a *.nupkg path redirects (302) to the stored package link; any other path must parse as releases.<channel>.json, then the access check runs
3. `server/handler/info/velopack_load.go` (`loadVelopackReleases`) — loads the tuple's releases from the database; an error answers with the empty feed
4. `mongod/velopack.go` (`RequiredIntermediateStep`) — runs only when localVersion is set and a latest published version exists; resolves meta ids and returns an empty string (no cap) when either version fails to parse
5. `mongod/check.go` (`CheckRequiredMigrationStep`) — returns the earliest required_intermediate version newer than localVersion and not newer than the latest published version, for the same channel and platform/arch
6. `server/utils/updaters/velopack/filter.go` (`CapAtVersion`) — drops every release whose version is above the intermediate step
7. `server/utils/updaters/velopack/feed.go` (`BuildFeed`) — renders the JSON document returned to the client

## Invariants

- A denied feed read returns HTTP 200 with {"Assets":[]}, while a denied .nupkg read returns 404 (TestFindVelopackFeedPrivateGate in server/handler/info/velopack_feed_test.go).
- An id query parameter that differs from the app name returns 404 before any access check runs.
- A failed intermediate lookup is logged as a warning and the uncapped feed is served, so a client can receive releases above its required step when that lookup fails.
