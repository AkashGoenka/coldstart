---
id: server-tuf-artifacts-handlers-go-a7fbb7f6
type: file
character: single
title: "server/tuf/artifacts/handlers.go"
anchors:
  - {"path":"server/tuf/artifacts/handlers.go","symbols":["PostPublishArtifacts","PostDeleteArtifacts","selectSignableArtifacts"],"hash":"sha256:f448e9880fa3","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:58.591Z
edits: 1
---

# server/tuf/artifacts/handlers.go

Publish and delete answer 202 before any signing: the work runs in a goroutine on context.Background(), and the caller learns the outcome only from the Redis task (GET /tuf/v1/task) or from tuf_signed on the artifact in Mongo. selectSignableArtifacts drops IsFeed artifacts and those already tuf_signed; an artifact that fails ConvertMongoArtifactToTUF is skipped with a log line, and only an all-failed batch returns 400. PostPublishArtifacts never reads the app's tuf flag. Delete is index-based and accepts only artifacts with tuf_signed=true; a version mismatch is 404, and when RemoveArtifacts fails the handler saves FAILURE and leaves the Mongo flags unchanged.
