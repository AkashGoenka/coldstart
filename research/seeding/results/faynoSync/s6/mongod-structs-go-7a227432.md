---
id: mongod-structs-go-7a227432
type: file
character: single
title: "mongod/structs.go"
anchors:
  - {"path":"mongod/structs.go","symbols":["AppRepository","versionSortStages","getBasePipeline"],"hash":"sha256:5cfee343b008","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.541Z
edits: 2
---

# mongod/structs.go

AppRepository (the interface every new repository method must be added to) is declared here, not in adapter.go. Version ordering is done in Mongo: version is split on '.', the first four parts are $toInt'd (major_v..build_v) and sorted descending, extra parts ignored, with no semver parsing in Go. getBasePipeline rewrites artifacts.platform/arch from ObjectIDs to names via $lookup, so callers see names. Meta lookup structs are declared per call because package-level ones would be shared across concurrent requests.
