---
id: app-controllers-api-v4-app-identifiers-controller-rb-0c979d87
type: file
character: single
title: "app/controllers/api/v4/app_identifiers_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","symbols":["create","create_params"],"hash":"sha256:76aeda829de8","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.443Z
edits: 1
---

# app/controllers/api/v4/app_identifiers_controller.rb

The URL does not select the build: the route nests under apps/:name/versions/:number/builds/:timestamp, but create_params permits only app_name, version_number, build_timestamp, identifier_type, value and visitor_id and never reads the path segments, so the request must carry the build as parameters. Nothing authenticates the request, and no OPTIONS preflight is declared for this route even though CorsSupport is included. On success the response is rendered from the claim's visitor, so the returned visitor id can differ from the posted visitor_id; on validation failure it renders the 422 from render_errors.
