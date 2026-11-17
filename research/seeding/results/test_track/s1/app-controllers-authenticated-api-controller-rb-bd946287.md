---
id: app-controllers-authenticated-api-controller-rb-bd946287
type: file
character: single
title: "app/controllers/authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/authenticated_api_controller.rb","symbols":["AuthenticatedApiController","authenticate"],"hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.089Z
edits: 1
---

# app/controllers/authenticated_api_controller.rb

Server-to-server auth. `authenticate` runs `authenticate_or_request_with_http_basic`, finds the App by the basic-auth username (`App.find_by(name:)`), and compares the password to `app.auth_secret` with `ActiveSupport::SecurityUtils.secure_compare`; on success it sets `@current_app`. The failure branch calls `head :unauthorized` inside the block. The only subclasses are the server-side endpoints: IdentifierTypes, SplitConfigs, SplitDetails, VisitorDetails and the v2 migrations controllers. None of them includes CorsSupport, so they send no CORS headers.
