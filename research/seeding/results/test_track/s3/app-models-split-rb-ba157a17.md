---
id: app-models-split-rb-ba157a17
type: file
character: hub
title: "app/models/split.rb"
anchors:
  - {"path":"app/models/split.rb","symbols":["active","reassign_weight","registry","registry_must_have_winning_variant_if_decided","registry_weights_must_be_integers","for_presentation","with_feature_incomplete_knockouts_for","with_remote_kill_knockouts_for","knock_out_weightings"],"hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:06.633Z
edits: 3
---

# app/models/split.rb

## Facets

- **active** — Without an app build it filters finished_at is null; with one, for_presentation uses finished_at greater than built_at, so an older build still sees a split that finished after it was built.
- **reassign_weight** — Pushes the current registry into previous_split_registries with superseded_at set to now, then overwrites registry; SplitUpsert#save is the caller that runs it.
- **registry** — A remote-kill override takes priority over feature_incomplete. Both paths rewrite weights through knock_out_weightings.
- **registry_must_have_winning_variant_if_decided** — Validation: a split with decided_at set must have a variant at weight 100.
- **registry_weights_must_be_integers** — Checks @registry_before_type_cast, which cast_registry sets before validation, so 25.5 fails even though the stored value is cast to an integer.
- **for_presentation** — Without an app build it returns splits with finished_at NULL and applies no knockouts. With one, it delegates to for_app_build, which compares finished_at against the build's built_at instead.
- **with_feature_incomplete_knockouts_for** — Adds a virtual feature_incomplete column. It is true for a feature gate (feature_gate = true) with no AppFeatureCompletion for that app whose version is at or below the build version. Splits with feature_gate = false are never flagged.
- **with_remote_kill_knockouts_for** — Adds the virtual column remote_kill_override_to from the matching AppRemoteKill. The window is first_bad_version <= build version and build version < fixed_version, with a NULL fixed_version meaning open-ended.
- **knock_out_weightings** — Feature knockouts target the variant named "false". If the split has no variant with the target name, the registry is returned unchanged and only a logger error is written, so the client receives the full weights.
