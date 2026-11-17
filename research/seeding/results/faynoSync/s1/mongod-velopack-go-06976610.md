---
id: mongod-velopack-go-06976610
type: file
character: single
title: "mongod/velopack.go"
anchors:
  - {"path":"mongod/velopack.go","symbols":["RequiredIntermediateStep"],"hash":"sha256:0de2531ba191","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:53.965Z
edits: 1
---

# mongod/velopack.go

RequiredIntermediateStep resolves app, channel, platform and arch names to meta ids and delegates to CheckRequiredMigrationStep. It returns an empty string with no error, meaning no cap, when either the current or the latest version does not parse with hashicorp/go-version, and it returns an error when a meta name is missing. CheckRequiredMigrationStep considers only published required_intermediate versions on the same channel and artifact platform/arch that are newer than the client's version and not newer than the latest, and it calls version.Must on every stored step version, so an unparseable stored step version panics on this path rather than being skipped.
