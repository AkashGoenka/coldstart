---
id: config-routes-rb-e801163e
type: file
character: single
title: "config/routes.rb"
anchors:
  - {"path":"config/routes.rb","symbols":["Api::V1::CorsController","CorsSupport"],"hash":"sha256:587252ce1c26","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:34.009Z
edits: 1
---

# config/routes.rb

Browser CORS preflight is hand-declared: each `match '<path>', to: '/api/v1/cors#allow', via: :options` line sits just above its `resource`, and nothing generates them. Only v1 (split_registry, assignment_event, identifier, visitors/:id, assignment_override) and v2 visitors/:id/assignment_overrides have one. Controllers that include CorsSupport but have no OPTIONS line here are v1 app_visitor_configs and app_identifier_visitor_configs, v2 split_registry, v3 and v4 split_registries, and v4 app_visitor_configs and app_identifiers, so a preflight to those paths never reaches a controller. Whether any browser calls them is not visible in this file. When SAML_ISSUER is set, admin sign-in routes to admin/sessions#new and sign-out routes to devise/sessions#destroy instead of the default Devise routes.
