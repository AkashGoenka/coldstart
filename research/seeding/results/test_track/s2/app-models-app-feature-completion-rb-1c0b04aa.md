---
id: app-models-app-feature-completion-rb-1c0b04aa
type: file
character: single
title: "app/models/app_feature_completion.rb"
anchors:
  - {"path":"app/models/app_feature_completion.rb","symbols":["AppFeatureCompletion","satisfied_by","feature_gate_must_be_a_feature_gate"],"hash":"sha256:423e4476eb85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.317Z
edits: 1
---

# app/models/app_feature_completion.rb

version is an integer array read through the custom :app_version type (app/types/app_version_type.rb, registered in config/initializers/types.rb), and a value that fails AppVersion parsing casts to nil, which the presence validation then rejects. satisfied_by(app_build) keeps the same app's completions whose version is <= the build's version; Split.arel_excluding_incomplete_features_for uses it in an EXISTS to exclude feature gates the build has not completed. feature_gate must be a Split whose feature_gate flag is true, and SplitUpsert sets that flag from the _enabled name suffix. Both App#feature_completions and Split#feature_completions declare dependent: :nullify, but the columns are null: false in db/schema.rb, so as written that nullify would write NULL into a NOT NULL column (not exercised).
