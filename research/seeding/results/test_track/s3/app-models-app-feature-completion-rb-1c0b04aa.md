---
id: app-models-app-feature-completion-rb-1c0b04aa
type: file
character: single
title: "app/models/app_feature_completion.rb"
anchors:
  - {"path":"app/models/app_feature_completion.rb","symbols":["satisfied_by","feature_gate_must_be_a_feature_gate"],"hash":"sha256:423e4476eb85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.641Z
edits: 1
---

# app/models/app_feature_completion.rb

A completion records that builds of the app at or above `version` include the feature. satisfied_by(app_build) is version <= build version, so one completion covers every later build of that app. feature_gate_must_be_a_feature_gate returns early when feature_gate is nil, so this model's own validation does not reject a missing gate; the migration class checks gate existence only on its destroy path.
