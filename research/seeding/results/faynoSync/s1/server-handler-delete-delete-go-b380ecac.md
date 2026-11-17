---
id: server-handler-delete-delete-go-b380ecac
type: file
character: hub
title: "server/handler/delete/delete.go"
anchors:
  - {"path":"server/handler/delete/delete.go","symbols":["DeleteSpecificVersionOfApp","DeleteSpecificArtifactOfApp"],"hash":"sha256:048ea1649e26","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:41.961Z
edits: 1
---

# server/handler/delete/delete.go

## Facets

- **DeleteSpecificVersionOfApp** — Calls create.InvalidateAppCaches with the channels of the deleted versions, and does so after the storage links are deleted.
- **DeleteSpecificArtifactOfApp** — Calls create.InvalidateAppCaches only when the repository reports result true, scoped to the artifact's channel (cacheChannel), and with no publish-field gate. Test TestDeleteSpecificArtifact_InvalidatesResponseCache in server/handler/artifact_delete_cache_test.go asserts the Redis key is dropped; its comment says it fails if this call is skipped.
