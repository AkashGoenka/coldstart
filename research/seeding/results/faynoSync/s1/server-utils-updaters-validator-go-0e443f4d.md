---
id: server-utils-updaters-validator-go-0e443f4d
type: file
character: single
title: "server/utils/updaters/validator.go"
anchors:
  - {"path":"server/utils/updaters/validator.go","symbols":["ValidatePrivate","feedUpdaterTypes"],"hash":"sha256:eba92020d28d","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.640Z
edits: 1
---

# server/utils/updaters/validator.go

ValidatePrivate rejects an updater whose name starts with squirrel_windows, sparkle, electron-builder or velopack when the app is private. It is called only from the version-upload path in server/handler/update/update.go (the updater query parameter). The platform-update path validates updaters with ValidateUpdaters, which takes no privacy argument. The velopack feed handler still serves private apps through the same gate (server/handler/info/velopack_feed.go), and TestFindVelopackFeedPrivateGate seeds private apps directly into Mongo, so the upload check is the only place this rule lives.
