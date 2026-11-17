---
id: app-controllers-api-v2-assignment-overrides-controller-rb-0b972d2c
type: file
character: single
title: "app/controllers/api/v2/assignment_overrides_controller.rb"
anchors:
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","symbols":["create","create_params"],"hash":"sha256:3112f28d70df","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.427Z
edits: 1
---

# app/controllers/api/v2/assignment_overrides_controller.rb

Authentication is inherited entirely: SharedSecretAuthenticatedApiController checks the HTTP basic password (username ignored) against BROWSER_EXTENSION_SHARED_SECRET before create runs, and a blank secret raises instead of returning 401. The visitor is read from the route, never the body, and force: true is merged into every item. A 204 means the whole batch committed; a missing assignments key is not rejected here and raises a missing-keyword ArgumentError from BatchArbitraryAssignmentCreation.new as an unhandled exception.
