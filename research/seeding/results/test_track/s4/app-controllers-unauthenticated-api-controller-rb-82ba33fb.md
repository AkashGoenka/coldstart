---
id: app-controllers-unauthenticated-api-controller-rb-82ba33fb
type: file
character: single
title: "app/controllers/unauthenticated_api_controller.rb"
anchors:
  - {"path":"app/controllers/unauthenticated_api_controller.rb","symbols":["return_json","render_errors"],"hash":"sha256:27996adc688e","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.439Z
edits: 1
---

# app/controllers/unauthenticated_api_controller.rb

return_json sets request.format to JSON before every action, so a client sending Accept: text/html still gets JSON, and verify_authenticity_token is skipped for all subclasses. render_errors turns any model's errors into a 422 with the body {errors: ...}, which is the shape the v4 identifier endpoint returns for validation failures. Neither method authenticates anything; subclasses that need a secret add their own before_action.
