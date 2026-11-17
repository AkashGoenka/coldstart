---
id: server-model-model-go-7025a5e9
type: file
character: single
title: "server/model/model.go"
anchors:
  - {"path":"server/model/model.go","symbols":["Artifact"],"hash":"sha256:7d673ea06327","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.748Z
edits: 1
---

# server/model/model.go

Artifact.HashesVerified is true only when faynoSync hashed the stored bytes itself: the upload paths set hashes_verified (update handler per uploaded file, create/upload.go, and mongod/create.go via lookupHashesVerified). The TUF publish step runs verifyUnverifiedArtifacts (server/tuf/artifacts/hashes_verify.go) on artifacts whose flag is false, checks their hashes against the bytes in storage, and rejects the whole publish if any one fails. Artifacts verified there are then marked by markArtifactsHashesVerified (server/tuf/artifacts/handlers.go).
