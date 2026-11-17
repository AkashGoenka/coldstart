---
id: server-utils-updaters-updaters-go-3733dfc1
type: file
character: single
title: "server/utils/updaters/updaters.go"
anchors:
  - {"path":"server/utils/updaters/updaters.go","symbols":["BuildResponse"],"hash":"sha256:ddfdb868efcf","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:31.572Z
edits: 1
---

# server/utils/updaters/updaters.go

BuildResponse is the only code that maps an updater type to a status and body. With no update (found false, possibleRollback false) squirrel_darwin, electron-builder and tauri return 204; squirrel_darwin also returns 204 when there is no update_url_zip key, electron-builder when there is no update_url_yml. squirrel_windows returns 302 whatever found is, with url taken from the update_url key (empty string if absent). tauri builds a new body from {version: latestVersion, notes, signature, url}, so the rest of the response map is dropped there. Tests: tauri_test.go TestBuildResponseTauriNoPayload (204 when no payload), TestBuildResponseTauriDeterministic.
