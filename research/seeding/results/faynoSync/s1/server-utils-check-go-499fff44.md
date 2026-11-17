---
id: server-utils-check-go-499fff44
type: file
character: single
title: "server/utils/check.go"
anchors:
  - {"path":"server/utils/check.go","symbols":["CheckPlatformsLatest"],"hash":"sha256:7b5c4e0b5f69","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:39.495Z
edits: 2
---

# server/utils/check.go

CheckPlatformsLatest returns the updater type that the handler passes to BuildResponse. An empty updater gets the apps_meta updater entry with default:true; a named updater matches a configured type exactly or by prefix ('squirrel' matches squirrel_darwin or squirrel_windows). I read only up to the first match branches, so the no-match behavior is not recorded here.
