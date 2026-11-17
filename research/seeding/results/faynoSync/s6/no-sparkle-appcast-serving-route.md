---
id: no-sparkle-appcast-serving-route
type: lesson
kind: absence
title: "no sparkle appcast serving route"
scope: {"terms":["sparkle","appcast"]}
status: active
updated: 2026-11-17T03:28:54.554Z
edits: 1
---

# no sparkle appcast serving route

server/server.go registers only GET /velopack/... as a feed route. Sparkle appcasts exist only as objects materializeSparkleKeys writes to the bucket under sparkle/<owner>/<app>/....

## Scope (absence — freshness = re-run this search)

- terms: `sparkle`, `appcast`
