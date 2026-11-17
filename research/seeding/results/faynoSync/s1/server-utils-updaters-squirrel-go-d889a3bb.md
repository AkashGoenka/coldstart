---
id: server-utils-updaters-squirrel-go-d889a3bb
type: file
character: single
title: "server/utils/updaters/squirrel.go"
anchors:
  - {"path":"server/utils/updaters/squirrel.go","symbols":["RewriteReleasesToAbsoluteURLs"],"hash":"sha256:f68b114b97d9","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:31.581Z
edits: 1
---

# server/utils/updaters/squirrel.go

RewriteReleasesToAbsoluteURLs rewrites only lines with at least 3 whitespace-separated fields whose second field has no '://'; those lines are re-joined with single spaces, so original spacing is not kept. Every line, rewritten or not, has trailing \r stripped, so CRLF input comes back LF. Tests: squirrel_test.go TestRewriteReleasesToAbsoluteURLs and TestRewriteReleasesPreservesAbsoluteAndMalformed.
