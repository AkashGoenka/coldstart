---
id: how-a-client-s-per-build-config-splits-plus-visitor-assignme
type: flow
title: "how a client's per-build config (splits plus visitor assignments) is computed"
anchors:
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/models/app_version_build_path.rb","hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:05.627Z
edits: 1
---

# how a client's per-build config (splits plus visitor assignments) is computed

The build rules (as_of built_at, incomplete feature gates, remote kills) are implemented twice with different effects: Split.for_app_build rewrites the served registry (target variant 100, others 0) while Assignment.for_app_build drops rows, so a killed or incomplete split still appears in `splits` but the visitor's stored assignment for it disappears, except that `force = true` assignments survive the incomplete-feature filter (not the remote-kill filter) while the registry is still knocked out. Both are driven by the same AppVersionBuildPath app_build in the v1/v4 AppVisitorConfigs and v4 AppIdentifiers controllers, which are unauthenticated. The no-build path (v1 visitors, split_registries) skips feature and kill checks entirely.

## Steps

1. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — validates AppVersionBuildPath, then calls Split.for_presentation(app_build:) and visitor.assignments_for(app_build) separately; unknown visitor ids are only find_or_initialize_by, nothing is created
2. `app/models/app_version_build_path.rb` (`app_build`) — turns URL parts into an App::Build (app_id, version, built_at); raises RecordNotFound for an unknown app
3. `app/models/split.rb` (`for_app_build`, `with_feature_incomplete_knockouts_for`, `with_remote_kill_knockouts_for`, `registry`) — adds virtual columns feature_incomplete and remote_kill_override_to; Split#registry reads them and returns knocked-out weights
4. `app/models/assignment.rb` (`for_app_build`, `excluding_incomplete_features_for`, `excluding_remote_kills_for`) — filters the visitor's rows with the same Split.arel_* predicates; force bypasses only the feature check
5. `app/models/app_remote_kill.rb` (`affecting`) — scope shared by both sides: first_bad_version <= build version and fixed_version null or greater
6. `app/models/app_feature_completion.rb` (`satisfied_by`) — feature gate is complete for a build when a completion row for that app has version <= build version
7. `app/models/visitor.rb` (`assignments_for`) — delegates to Assignment.for_presentation(app_build:), which also hides decision-overridden rows

## Invariants

- a change to a build rule must be made in both Split and Assignment scopes (they share the Split.arel_* helpers but nothing forces both to be used)
- the build's built_at is also the as_of for finished splits, so a finished split still serves to builds older than its finished_at
