---
id: tsdown-ws-config-ts-417e9786
type: file
character: single
title: "tsdown.ws.config.ts"
anchors:
  - {"path":"tsdown.ws.config.ts","symbols":["exclusions"],"hash":"sha256:0683262b8101","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.957Z
edits: 2
---

# tsdown.ws.config.ts

The ws bundle is built from the same entry as api; this config's plugin regex removes app.use('/api' ...) statements, matching the closing quote right after /api, so app.use('/api/status') stays in the ws bundle behind the runtime env.TYPE gate. The api config has no such plugin.
