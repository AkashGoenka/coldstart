---
id: src-services-moderation-ts-1b4a6cb5
type: file
character: hub
title: "src/services/Moderation.ts"
anchors:
  - {"path":"src/services/Moderation.ts","symbols":["suspendUsersBatch"],"hash":"sha256:84b473cb43d1","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:20.666Z
edits: 1
---

# src/services/Moderation.ts

## Facets

- **suspendUsersBatch** — Upserts suspension rows keyed by userId. suspendedAt is set only by the create branch (column default now()), so re-suspending an existing row does not restart the 15-day clock that scheduleSuspendedAccountDeletion reads. expireAt is null when no days are passed, which makes the suspension permanent. The founder badge blocks the call.
