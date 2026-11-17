---
id: app-controllers-api-v4-app-visitor-configs-controller-rb-3c54b45d
type: file
character: single
title: "app/controllers/api/v4/app_visitor_configs_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","symbols":["show","visitor_id","experience_sampling_weight"],"hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.410Z
edits: 2
---

# app/controllers/api/v4/app_visitor_configs_controller.rb

show returns 422 with the build path's errors unless app name, version and timestamp validate; otherwise splits and assignments are both computed from the same app_build object. An unknown visitor_id creates nothing: find_or_initialize_by yields an empty assignment list, while a missing visitor_id parameter raises from params.fetch. The split registries in the response are whatever Split.for_presentation returns, so knockouts are applied there, not in this controller. Compared with the v1 config controller, the only addition is @experience_sampling_weight from Rails.configuration, which the v4 partial renders.
