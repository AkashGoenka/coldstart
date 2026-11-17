---
id: app-controllers-api-v1-assignment-events-controller-rb-7fd3feaa
type: file
character: single
title: "app/controllers/api/v1/assignment_events_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","symbols":["create","create_params"],"hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:34.073Z
edits: 1
---

# app/controllers/api/v1/assignment_events_controller.rb

This controller inherits UnauthenticatedApiController and has no credential check, so anyone who can reach POST /api/v1/assignment_event can create an assignment for any visitor_id and split_name. Its only write is DeterministicAssignmentCreation.create!, and create_params permits visitor_id, split_name, mixpanel_result and context. Its CORS preflight is served by the OPTIONS stub in config/routes.rb that points at Api::V1::CorsController#allow.
