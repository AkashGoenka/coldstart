---
id: app-controllers-api-v1-cors-controller-rb-2c96fc9f
type: file
character: single
title: "app/controllers/api/v1/cors_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/cors_controller.rb","symbols":["Api::V1::CorsController","allow"],"hash":"sha256:cda2e1286600","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.106Z
edits: 1
---

# app/controllers/api/v1/cors_controller.rb

The only action is `allow`, which returns 204 with no body. It is the target of every `via: :options` route in routes.rb. Its preflight headers come entirely from CorsSupport, and it does not check the origin itself: a disallowed origin still gets the 204, just without Access-Control-Allow-Origin.
