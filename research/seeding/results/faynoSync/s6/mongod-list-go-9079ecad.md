---
id: mongod-list-go-9079ecad
type: file
character: single
title: "mongod/list.go"
anchors:
  - {"path":"mongod/list.go","symbols":["listItems","ListApps","ListChannels"],"hash":"sha256:024eb33d8c29","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.537Z
edits: 2
---

# mongod/list.go

listItems caps every list at 100 documents with no paging. A team caller is filtered to owner = teamUser.Owner and _id in the Allowed list; an empty or all-malformed list returns an empty result, not the whole tenant. On the non-team path (including fns_ tokens) it filters only by owner, and an empty owner argument adds no owner restriction; no allowed_apps filter is applied.
