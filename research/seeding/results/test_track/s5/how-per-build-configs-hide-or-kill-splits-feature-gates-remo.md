---
id: how-per-build-configs-hide-or-kill-splits-feature-gates-remo
type: flow
title: "how per-build configs hide or kill splits (feature gates, remote kills, as_of)"
anchors:
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/models/app_feature_completion.rb","hash":"sha256:423e4476eb85","head":"435fea8235b5"}
  - {"path":"app/models/app_version_build_path.rb","hash":"sha256:edf5f7cac1ed","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.851Z
edits: 1
---

# how per-build configs hide or kill splits (feature gates, remote kills, as_of)

The visitor config/registry a client sees is computed per app build, not globally: Split.for_presentation(app_build:) adds two virtual columns (feature_incomplete via AppFeatureCompletion, remote_kill_override_to via AppRemoteKill) and Split#registry then rewrites weights on the fly to 100% for the kill target or 0% for everything-but-'false' ('knock out') - the DB registry is untouched. Splits are also filtered by finished_at > build timestamp, so old builds still see splits retired later. Records loaded this way are .readonly because of the custom select. Assignments get the same filters via Assignment.for_app_build, so a killed split's stored assignment is hidden, not deleted.

## Steps

1. `app/models/split.rb` (`for_app_build`, `with_feature_incomplete_knockouts_for`, `with_remote_kill_knockouts_for`, `registry`, `knock_out_weightings`) — scopes + registry override
2. `app/models/assignment.rb` (`for_app_build`, `excluding_remote_kills_for`, `excluding_incomplete_features_for`) — matching assignment-side filtering; force=true bypasses the feature-incomplete filter only
3. `app/models/app_remote_kill.rb` (`affecting`, `overlapping`) — version-range match first_bad_version <= v < fixed_version; overlapping ranges for same app+split are rejected
4. `app/models/app_feature_completion.rb` (`satisfied_by`) — gate is complete for builds with version >= completion version
5. `app/models/app_version_build_path.rb` (`AppVersionBuildPath`) — validates app/version/build timestamp and builds App::Build

## Invariants

- Knockout of a feature-incomplete gate defaults to variant 'false'; if the target variant doesn't exist it logs an error and returns the original registry
- Version columns are int arrays, compared via AppVersion
