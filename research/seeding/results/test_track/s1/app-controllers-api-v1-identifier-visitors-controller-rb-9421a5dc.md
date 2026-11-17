---
id: app-controllers-api-v1-identifier-visitors-controller-rb-9421a5dc
type: file
character: single
title: "app/controllers/api/v1/identifier_visitors_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/identifier_visitors_controller.rb","symbols":["Api::V1::IdentifierVisitorsController","show"],"hash":"sha256:ae02130e64b0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.111Z
edits: 1
---

# app/controllers/api/v1/identifier_visitors_controller.rb

Unauthenticated, but it does not include CorsSupport and routes.rb declares no OPTIONS path for it, so browsers get no Access-Control-Allow-Origin on this GET. The other unauthenticated v1 visitor endpoints (VisitorsController, IdentifiersController) do include CorsSupport. `show` passes only `identifier_type_name` and `identifier_value` to `VisitorLookup`.
