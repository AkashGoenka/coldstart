---
id: server-handler-info-feed-tuples-go-b9075e54
type: file
character: single
title: "server/handler/info/feed_tuples.go"
anchors:
  - {"path":"server/handler/info/feed_tuples.go","symbols":["TupleFromContext","versionTuples","SparkleVersionTuples","VelopackVersionTuples"],"hash":"sha256:57ddedcc139b","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.969Z
edits: 1
---

# server/handler/info/feed_tuples.go

TupleFromContext returns nil unless channel, platform and arch are all non-empty, and nil is the signal that every ForTuplesOrFull caller reads as regenerate-the-whole-app. versionTuples silently drops any artifact whose channel, platform or arch does not resolve in apps_meta, so a version with unresolved names can yield fewer tuples, and an empty result also triggers the full fallback. SparkleVersionTuples and VelopackVersionTuples are the only callers of versionTuples, and each selects artifacts by a non-nil Sparkle or Velopack field.
