---
id: app-controllers-authenticated-api-controller-rb-bd946287
type: file
character: single
title: "app/controllers/authenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/authenticated_api_controller.rb","symbols":["authenticate","current_app"],"hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:34.082Z
edits: 1
---

# app/controllers/authenticated_api_controller.rb

HTTP Basic where the username is the App name and the password is compared to app.auth_secret; an unknown app and a wrong secret both return 401 (spec/controllers/authenticated_api_controller_spec.rb). On success it sets @current_app, the only place a controller learns the calling app. The `authenticate` method is declared public, unlike the other base controllers' filters, though no route maps to it.
