---
id: app-controllers-authenticated-api-controller-rb-bd946287
type: file
character: single
title: "app/controllers/authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/authenticated_api_controller.rb","symbols":["AuthenticatedApiController","authenticate","current_app"],"hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.974Z
edits: 1
---

# app/controllers/authenticated_api_controller.rb

Every request is HTTP Basic auth where the username is the app's name and the password is its auth_secret; `before_action :authenticate` is declared here, so every subclass inherits it and must `skip_before_action :authenticate` to opt out (UnauthenticatedApiController, the base above it, has no auth). Unknown app name and wrong secret both `head :unauthorized`; the secret check is ActiveSupport::SecurityUtils.secure_compare, run only after the app is found. On success it sets `@current_app`, and controllers scope their queries through it (e.g. `current_app.splits.find_by!`, `owner_app: current_app`), which is how an app reaches only its own rows.
