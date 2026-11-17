---
id: app-models-assignment-rb-aea791e3
type: file
character: hub
title: "app/models/assignment.rb"
anchors:
  - {"path":"app/models/assignment.rb","symbols":["for_presentation","for_app_build","excluding_remote_kills_for","excluding_incomplete_features_for","except_feature_gates"],"hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:53.028Z
edits: 2
---

# app/models/assignment.rb

for_presentation ignores kills and decision overrides unless an app_build is passed; with one it runs for_app_build, which applies excluding_remote_kills_for. force bypasses only the feature-gate filter (excluding_incomplete_features_for, where force = true short-circuits), not the remote kill filter, so a forced assignment still disappears under a kill.

## Facets

- **for_presentation** — Without an app_build it is excluding_decision_overrides plus active splits only. Decision overrides keep a row only when its updated_at is later than the split's decided_at, so a row written after a decision stays visible while older rows drop out.
- **excluding_incomplete_features_for** — The gate check is (force = true) OR Split.arel_excluding_incomplete_features_for. force skips the feature-gate check only; excluding_remote_kills_for has no force branch, so forced rows are still hidden by remote kills.
- **except_feature_gates** — Joins split and filters feature_gate = false. It is used only by VisitorSupersession#merge_assignments!, so gate rows are never copied between visitors.
