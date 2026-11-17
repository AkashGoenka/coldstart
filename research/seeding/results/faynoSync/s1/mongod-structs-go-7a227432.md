---
id: mongod-structs-go-7a227432
type: file
character: single
title: "mongod/structs.go"
anchors:
  - {"path":"mongod/structs.go","symbols":["getBasePipeline","appMetaDoc","metaIDDoc"],"hash":"sha256:5cfee343b008","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:21.352Z
edits: 1
---

# mongod/structs.go

`getBasePipeline` joins `apps` to `apps_meta` three ways (the app via app_id, the channel via channel_id, and each artifact's platform and arch), unwinds artifacts, and regroups by `_id`. It overwrites `artifacts.platform` and `artifacts.arch` with the joined `platform_name` and `arch_id` strings, so aggregate results carry names where the stored documents hold ObjectIds. The `appMetaDoc` and `metaIDDoc` types exist because meta lookups decode into per-call variables; the comment says package-level variables would be shared across concurrent requests.
