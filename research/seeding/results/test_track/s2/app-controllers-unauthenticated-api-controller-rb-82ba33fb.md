---
id: app-controllers-unauthenticated-api-controller-rb-82ba33fb
type: file
character: single
title: "app/controllers/unauthenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/unauthenticated_api_controller.rb","symbols":["return_json","render_errors"],"hash":"sha256:27996adc688e","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.358Z
edits: 1
---

# app/controllers/unauthenticated_api_controller.rb

This base class authenticates nothing: it skips CSRF verification and forces every request to JSON. Auth is opt-in per subclass: AuthenticatedApiController checks HTTP Basic against App name and auth_secret (secure_compare), and SharedSecretAuthenticatedApiController checks only the password against the BROWSER_EXTENSION_SHARED_SECRET env var and raises if it is unset. Api::V1::AssignmentEventsController inherits this base directly with no auth filter, and the other direct subclasses (v1 visitors, identifiers and split registries; v2 and v4 split registries and app visitor configs) also inherit it, so check each for its own filter before assuming it is authenticated. A new controller that inherits from here gets no auth check.
