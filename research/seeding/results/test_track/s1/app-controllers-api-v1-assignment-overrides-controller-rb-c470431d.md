---
id: app-controllers-api-v1-assignment-overrides-controller-rb-c470431d
type: file
character: single
title: "app/controllers/api/v1/assignment_overrides_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","symbols":["Api::V1::AssignmentOverridesController","create"],"hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:10.102Z
edits: 1
---

# app/controllers/api/v1/assignment_overrides_controller.rb

Single-assignment override endpoint. It is the only one of the two that passes the client's mixpanel_result through (it is permitted and reaches ArbitraryAssignmentCreation unchanged); v2 hardcodes 'success' in the batch model. It returns 204 with no body, so the caller cannot tell whether the call inserted a row or superseded one.
