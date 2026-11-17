---
id: app-models-app-feature-completion-rb-1c0b04aa
type: file
character: single
title: "app/models/app_feature_completion.rb"
anchors:
  - {"path":"app/models/app_feature_completion.rb","symbols":["satisfied_by"],"hash":"sha256:423e4476eb85","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.020Z
edits: 1
---

# app/models/app_feature_completion.rb

satisfied_by compares the stored version to the build's version number, not to built_at: a completion at 1.1 satisfies every build whose version is 1.1 or higher, however late it was built. The completion's feature_gate must be a feature gate (validation), and the scope is consumed only by Split.arel_excluding_incomplete_features_for and Assignment.excluding_incomplete_features_for.
