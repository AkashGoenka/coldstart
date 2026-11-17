---
id: src-services-channel-ts-d9995ba4
type: file
character: hub
title: "src/services/Channel.ts"
anchors:
  - {"path":"src/services/Channel.ts","symbols":["deleteServerChannel"],"hash":"sha256:260b96bf059b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.671Z
edits: 1
---

# src/services/Channel.ts

## Facets

- **deleteServerChannel** — Refuses to delete the default channel. Deleting is a mark (channel.deleting true, webhooks marked, scheduleMessageDelete upserted, system channel reference cleared); the rows are removed later by scheduleDeleteMessages in src/index.ts.
