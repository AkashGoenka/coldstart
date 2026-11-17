---
id: app-controllers-shared-secret-authenticated-api-controller-r-48882c0a
type: file
character: single
title: "app/controllers/shared_secret_authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","symbols":["authenticate","shared_secret"],"hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.431Z
edits: 1
---

# app/controllers/shared_secret_authenticated_api_controller.rb

authenticate raises a RuntimeError when BROWSER_EXTENSION_SHARED_SECRET is nil or empty, before any credential is checked, so a deployment without the variable fails every request to the subclasses instead of returning 401. With the variable set, it uses authenticate_or_request_with_http_basic and ActiveSupport::SecurityUtils.secure_compare on the password only, so a wrong or missing password gets the basic-auth challenge. The base class also inherits the JSON format forcing and CSRF skip from UnauthenticatedApiController.
