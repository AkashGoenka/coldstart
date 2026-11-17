---
id: app-controllers-shared-secret-authenticated-api-controller-r-48882c0a
type: file
character: single
title: "app/controllers/shared_secret_authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","symbols":["authenticate","shared_secret","SHARED_SECRET_ENV_VAR"],"hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.930Z
edits: 2
---

# app/controllers/shared_secret_authenticated_api_controller.rb

Authentication is a single constant-time comparison of ENV BROWSER_EXTENSION_SHARED_SECRET against the HTTP Basic password; the username argument is ignored. If the variable is unset or blank the action raises a RuntimeError naming the variable rather than returning 401, so a misconfigured server fails every override request loudly.
