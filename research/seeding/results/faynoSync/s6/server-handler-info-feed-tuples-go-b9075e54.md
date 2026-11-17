---
id: server-handler-info-feed-tuples-go-b9075e54
type: file
character: single
title: "server/handler/info/feed_tuples.go"
anchors:
  - {"path":"server/handler/info/feed_tuples.go","symbols":["skipPrivateMaterialization","TupleFromContext","versionTuples"],"hash":"sha256:57ddedcc139b","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.486Z
edits: 2
---

# server/handler/info/feed_tuples.go

Private apps never materialize feeds: skipPrivateMaterialization is a silent no-op keyed on the upload link containing /download?key=. The per-tuple path drops tuples with an empty channel/platform/arch name, but the whole-app discovery path (discoverVelopackTuples, discoverSparkleTuples) does not.
