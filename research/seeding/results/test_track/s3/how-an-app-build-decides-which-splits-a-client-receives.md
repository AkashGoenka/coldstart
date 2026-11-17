---
id: how-an-app-build-decides-which-splits-a-client-receives
type: flow
title: "how an app build decides which splits a client receives"
anchors:
  - {"path":"app/models/app_version_build_path.rb","hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
  - {"path":"app/models/app.rb","hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/split_registries_controller.rb","hash":"sha256:06318cf68bfb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.670Z
edits: 1
---

# how an app build decides which splits a client receives

Knockouts are SQL in Split.for_app_build, not Ruby: a feature-gate split with no AppFeatureCompletion at or below the build version stays in the registry, but its weights are rewritten to 100 on the "false" variant. Remote kills win over feature knockouts because Split#registry checks remote_kill_override_to first. If the target variant does not exist on the split, the weights are left unchanged and only an error is logged.

## Steps

1. `app/models/app_version_build_path.rb` (`app_build`) — Validates the three request params, then loads App by name with find_by! and builds App::Build with the client's build_timestamp.
2. `app/models/app.rb` (`define_build`, `Build`) — Produces the build value object: the version is parsed with AppVersion.new and built_at with Time.zone.parse.
3. `app/models/split.rb` (`for_presentation`, `for_app_build`, `with_feature_incomplete_knockouts_for`, `with_remote_kill_knockouts_for`, `registry`, `knock_out_weightings`) — Applies active(as_of: built_at), the two virtual columns, and the registry rewrite that turns them into weights.
4. `app/models/app_feature_completion.rb` (`satisfied_by`) — Supplies the SQL predicate that marks a feature gate as complete for a build (version <= build version).
5. `app/models/app_remote_kill.rb` (`affecting`) — Supplies the SQL window for a remote kill and its override_to variant.
6. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — Entry point for an app-scoped config: validates the build path, then calls Split.for_presentation(app_build:) and visitor.assignments_for(app_build).
7. `app/controllers/api/v1/split_registries_controller.rb` (`show`) — The v1 registry calls Split.for_presentation with no build, so it gets active splits with no knockouts.

## Invariants

- A feature gate with feature_gate = false is never knocked out.
- A remote kill applies when first_bad_version <= build version < fixed_version, with NULL fixed_version open-ended.
- Active-ness is judged against the client-supplied build_timestamp, not the server clock.
