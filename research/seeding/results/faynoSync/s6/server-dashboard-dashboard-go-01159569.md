---
id: server-dashboard-dashboard-go-01159569
type: file
character: single
title: "server/dashboard/dashboard.go"
anchors:
  - {"path":"server/dashboard/dashboard.go","symbols":["Register","serve","uiFS","Config"],"hash":"sha256:bc9c398a61d1","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.544Z
edits: 2
---

# server/dashboard/dashboard.go

The UI is go:embed'ed (ui/.gitkeep exists only so the pattern compiles) and served from ui/dist; if index.html is absent startup only warns and /dashboard/ answers 503. config.json is intercepted before any file lookup and generated from the Config struct (DASHBOARD_TUF_METADATA_URL), so a built file of that name is never served. Missing paths under assets/ are 404, any other missing path falls back to index.html; assets/ is immutable-cached, the rest no-cache. GET and HEAD are registered explicitly because gin does not route HEAD to GET handlers. Served without authentication; the root redirect sets no security headers, serve does.
