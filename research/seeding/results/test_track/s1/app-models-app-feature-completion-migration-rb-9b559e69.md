---
id: app-models-app-feature-completion-migration-rb-9b559e69
type: file
character: single
title: "app/models/app_feature_completion_migration.rb"
anchors:
  - {"path":"app/models/app_feature_completion_migration.rb","symbols":["AppFeatureCompletionMigration","feature_gate_model","destroy?"],"hash":"sha256:f9a8a9ed3c53","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.754Z
edits: 1
---

# app/models/app_feature_completion_migration.rb

Same blank-means-delete shape as the remote-kill wrapper: a nil or empty version destroys the AppFeatureCompletion for the gate, and deleting one that does not exist returns success (spec-asserted). The gate is looked up with Split.find_by(name:) unscoped, so the app can name another app's gate. A completion only satisfies a feature gate for builds at or above its version (AppFeatureCompletion.satisfied_by), and until then Split#registry presents that gate's 'false' variant at 100.
