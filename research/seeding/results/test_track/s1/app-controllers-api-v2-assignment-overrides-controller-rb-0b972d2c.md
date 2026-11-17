---
id: app-controllers-api-v2-assignment-overrides-controller-rb-0b972d2c
type: file
character: single
title: "app/controllers/api/v2/assignment_overrides_controller.rb"
anchors:
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","symbols":["Api::V2::AssignmentOverridesController","create"],"hash":"sha256:3112f28d70df","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:10.108Z
edits: 1
---

# app/controllers/api/v2/assignment_overrides_controller.rb

Batch override endpoint: the params are an assignments array of split_name/variant/context, with force: true merged at the top level for the whole batch. It never accepts mixpanel_result from the client; that value is forced to 'success' one layer down in BatchArbitraryAssignmentCreation.
