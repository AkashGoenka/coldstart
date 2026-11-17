---
id: app-controllers-shared-secret-authenticated-api-controller-r-48882c0a
type: file
character: single
title: "app/controllers/shared_secret_authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","symbols":["SharedSecretAuthenticatedApiController","authenticate","shared_secret"],"hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.095Z
edits: 2
---

# app/controllers/shared_secret_authenticated_api_controller.rb

Shared-secret auth for the Chrome-extension override endpoints only (the v1 and v2 AssignmentOverridesController, both of which also include CorsSupport). `authenticate` raises when `BROWSER_EXTENSION_SHARED_SECRET` is nil or blank, before it reads any credential, so a missing secret is a server error, not a 401. The HTTP basic username is ignored (`_username`) and only the password is compared, with `secure_compare`, so any username works as long as the password matches.
