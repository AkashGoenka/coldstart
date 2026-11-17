---
id: how-a-build-s-version-and-built-at-decide-which-splits-and-a
type: flow
title: "how a build's version and built_at decide which splits and assignments a client sees"
anchors:
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/models/app_version_build_path.rb","hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
  - {"path":"app/models/app.rb","hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/app_visitor_configs/_show.json.jbuilder","hash":"sha256:c14723406673","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:19.986Z
edits: 1
---

# how a build's version and built_at decide which splits and assignments a client sees

Knockouts reach the client two different ways: a split stays in the response with its registry rewritten (remote kill override, or 'false' for an incomplete feature gate), while assignment rows are dropped (remote kills always, incomplete features unless force). Both come from the same app_build in one request, so a visitor can get the knocked-out registry and no stored assignment for that split. built_at drives the finished-split cut and the window checks use the version number, so the two axes are independent.

## Steps

1. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — validates the build path (422 on failure), then loads active splits and the visitor's assignments from the same app_build
2. `app/models/app_version_build_path.rb` (`app_build`) — turns the request's app name, version and ISO timestamp into an App::Build; raises unless valid
3. `app/models/app.rb` (`define_build`) — wraps version and built_at into App::Build; the version becomes an AppVersion
4. `app/models/split.rb` (`for_presentation`, `for_app_build`, `with_remote_kill_knockouts_for`, `with_feature_incomplete_knockouts_for`, `registry`) — adds active(as_of: built_at) and two virtual columns; registry rewrites weights from them
5. `app/models/app_remote_kill.rb` (`affecting`) — per-split subquery returning override_to for kills whose version window contains the build
6. `app/models/app_feature_completion.rb` (`satisfied_by`) — a gate counts as complete when a completion row has version <= the build's version
7. `app/models/assignment.rb` (`for_presentation`, `for_app_build`, `excluding_incomplete_features_for`, `excluding_remote_kills_for`) — removes assignment rows for incomplete gates (unless force) and for remote-killed splits
8. `app/models/visitor.rb` (`assignments_for`) — scopes a visitor's assignments through Assignment.for_presentation(app_build:)
9. `app/views/api/v4/app_visitor_configs/_show.json.jbuilder` — emits each split's (already knocked-out) registry and feature_gate flag, plus the assignments; no filtering here

## Invariants

- Split.registry rewrites weights only for records loaded through for_app_build or the two with_*_knockouts_for scopes; a bare Split returns its stored registry.
- When a remote kill and an incomplete feature both apply, the remote kill's override_to wins (split_spec.rb, 'prefers a remote kill over a feature incompletion').
- force: true bypasses only the incomplete-feature filter; remote-kill exclusion ignores force (assignment_spec.rb, 'doesn't return assignments for overlapping remote kills, even if forced').
- Splits finished before built_at are hidden from that build (finished_at > built_at keeps a split). Splits finished after built_at stay visible.
- Feature completions and remote kills compare the version number, not built_at.
