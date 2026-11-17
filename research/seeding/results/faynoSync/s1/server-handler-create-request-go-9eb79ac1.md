---
id: server-handler-create-request-go-9eb79ac1
type: file
character: single
title: "server/handler/create/request.go"
anchors:
  - {"path":"server/handler/create/request.go","symbols":["ResolveUploadRequest","ResolveAppVisibility"],"hash":"sha256:a14f7239f164","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:36.651Z
edits: 1
---

# server/handler/create/request.go

ResolveUploadRequest is the auth, owner, parameter and team-access gate that UploadApp and InitPresignedUpload both run. CompletePresignedUpload does not call it: it re-checks only API-token app scope and team-user access on the params parsed from the stored data string, so ValidateParams is not re-run at complete. ResolveAppVisibility returns the private flag from CheckPrivate (404 when the app is not found) and rejects updaters that need a public feed; complete calls it too, and then compares the result with the visibility stored at init.
