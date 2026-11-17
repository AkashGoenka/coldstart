---
id: server-handler-update-update-go-0e4d4b1c
type: file
character: hub
title: "server/handler/update/update.go"
anchors:
  - {"path":"server/handler/update/update.go","symbols":["UpdateItem","UpdateSpecificApp"],"hash":"sha256:40435451fd8b","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.784Z
edits: 1
---

# server/handler/update/update.go

## Facets

- **UpdateItem** — Success responses use different keys: UpdateItem returns update<Type>Result.Updated (for example updateAppResult.Updated), while UpdateSpecificApp returns updatedResult.Updated.
- **UpdateSpecificApp** — For velopack, an empty or failed tuple lookup falls back to full-app materialization, because MaterializeVelopackForTuplesOrFull treats len(tuples)==0 as the whole-app path (info/velopack_materialize.go:68). Slack is notified only when files were uploaded.
