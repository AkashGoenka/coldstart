---
id: app-controllers-api-v1-assignment-events-controller-rb-7fd3feaa
type: file
character: single
title: "app/controllers/api/v1/assignment_events_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","symbols":["create","create_params"],"hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.933Z
edits: 1
---

# app/controllers/api/v1/assignment_events_controller.rb

Anonymous endpoint (UnauthenticatedApiController skips CSRF) that always answers 204 on success, whichever branch ran, so clients cannot tell from the response whether anything was written. The permit list excludes variant, so a client-sent variant is dropped silently rather than rejected. After-action set_cors_headers calls ENV['WHITELIST_CORS_HOSTS'] through cors_allowed?, which raises when the variable is unset, so the endpoint errors on every request without it. Nothing here rescues RecordNotFound (unknown split_name) or RecordInvalid (mixpanel_result outside success/failure).
