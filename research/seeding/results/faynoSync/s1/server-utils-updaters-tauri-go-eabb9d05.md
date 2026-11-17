---
id: server-utils-updaters-tauri-go-eabb9d05
type: file
character: single
title: "server/utils/updaters/tauri.go"
anchors:
  - {"path":"server/utils/updaters/tauri.go","symbols":["tauriUpdateURL","tauriPayloadPriority"],"hash":"sha256:b241ceb9306a","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:31.576Z
edits: 1
---

# server/utils/updaters/tauri.go

tauriUpdateURL picks which update_url_<pkg> the tauri client downloads: the first match in tauriPayloadPriority (app.tar.gz, appimage.tar.gz, nsis.zip, msi.zip, gz, zip, exe, msi, appimage), skipping sig and dmg keys. If none matches it takes the alphabetically first remaining key, and a bare update_url (package "") sorts first, so it is picked only when no priority package exists. Returns ok=false when no candidate exists, which makes BuildResponse answer 204.
