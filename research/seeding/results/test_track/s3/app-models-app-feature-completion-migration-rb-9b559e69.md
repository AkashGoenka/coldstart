---
id: app-models-app-feature-completion-migration-rb-9b559e69
type: file
character: single
title: "app/models/app_feature_completion_migration.rb"
anchors:
  - {"path":"app/models/app_feature_completion_migration.rb","symbols":["destroy?","feature_gate_model","feature_gate_must_exist"],"hash":"sha256:f9a8a9ed3c53","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.659Z
edits: 1
---

# app/models/app_feature_completion_migration.rb

A blank version means delete: destroy? is true and save destroys the (app, feature_gate) completion. Only that destroy path runs feature_gate_must_exist, so an unknown gate name is rejected on delete but not on create, where valid? delegates to AppFeatureCompletion. Writes use find_or_initialize_by(feature_gate:), so a POST for a gate that already has a completion updates that row in place.
