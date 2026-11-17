---
id: app-controllers-api-v1-app-visitor-configs-controller-rb-f0666a07
type: file
character: single
title: "app/controllers/api/v1/app_visitor_configs_controller.rb"
anchors:
  - {"path":"app/controllers/api/v1/app_visitor_configs_controller.rb","symbols":["show","for_presentation"],"hash":"sha256:17edc81d66c2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.391Z
edits: 1
---

# app/controllers/api/v1/app_visitor_configs_controller.rb

Config show on v1 resolves the build through AppVersionBuildPath (422 when invalid), calls Split.for_presentation(app_build:) so knockouts apply, and loads the visitor's assignments for that build. It is the same computation as the v4 controller; v1 differs in the view it renders (name-keyed weights, assignment context and unsynced) and in omitting experience_sampling_weight. An unknown visitor_id is read through find_or_initialize_by and nothing is written.
