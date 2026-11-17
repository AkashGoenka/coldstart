---
id: server-utils-updaters-updaters-go-3733dfc1
type: file
character: single
title: "server/utils/updaters/updaters.go"
anchors:
  - {"path":"server/utils/updaters/updaters.go","symbols":["BuildResponse"],"hash":"sha256:ddfdb868efcf","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.435Z
edits: 2
---

# server/utils/updaters/updaters.go

BuildResponse applies the updater after the lookup. squirrel_windows always 302s to update_url (even when up to date); squirrel_darwin is 204 when not found and not a rollback, or when no update_url_zip exists; electron-builder is 204 unless found or possibleRollback, then 302 to update_url_yml; tauri rebuilds the body from scratch (version = latestVersion argument, notes, signature, url; update_available/critical dropped) and a rollback returns 200 with the older version; unknown updaters return the plain response with 200.
