---
id: no-dynamic-sparkle-appcast-route-in-this-repo
type: lesson
kind: absence
title: "no dynamic sparkle appcast route in this repo"
scope: {"terms":["sparkle","appcast","route","/velopack"]}
status: active
updated: 2026-11-17T03:26:53.974Z
edits: 1
---

# no dynamic sparkle appcast route in this repo

Velopack has a live feed route, but Sparkle does not: the only feed route in server/server.go is GET /velopack/:owner/:app/:platform/:arch/*feed (FindVelopackFeed), and a search of every non-test router.GET/POST/Any/Handle registration found no sparkle or appcast path. Sparkle appcasts exist only as objects written to storage by MaterializeSparkle* at sparkle/<owner>/<app>/<platform>/<arch>/appcast.<channel>.xml.

## Scope (absence — freshness = re-run this search)

- terms: `sparkle`, `appcast`, `route`, `/velopack`
