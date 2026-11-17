---
id: mongod-check-go-9591be63
type: file
character: single
title: "mongod/check.go"
anchors:
  - {"path":"mongod/check.go","symbols":["CheckLatestVersion"],"hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:31.586Z
edits: 1
---

# mongod/check.go

CheckLatestVersion sets the flags BuildResponse keys on: requested version below latest gives Found=true; equal gives Found=false with no changelog and no PossibleRollback; above gives Found=false with PossibleRollback=true. The required-intermediate early return sets Found=true and IsRequiredIntermediate but no LatestVersion, so a tauri response on that path has version "". RolloutPercent is set only on the Found paths.
