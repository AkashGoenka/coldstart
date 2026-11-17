---
id: app-models-split-rb-ba157a17
type: file
character: hub
title: "app/models/split.rb"
anchors:
  - {"path":"app/models/split.rb","symbols":["registry","knock_out_weightings","for_presentation","reassign_weight","name_must_only_be_prefixed_with_app_name","name_contains_new?"],"hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.340Z
edits: 1
---

# app/models/split.rb

## Facets

- **registry** — Not the stored column. When the for_app_build scope has supplied the virtual attributes remote_kill_override_to or feature_incomplete?, it returns a knocked-out weighting: the target variant at 100 and every other variant at 0. Without an app build the stored registry is returned as-is.
- **knock_out_weightings** — If the override variant is not a key of the registry, it only logs an error and returns the stored weights unchanged, so a bad remote-kill target silently serves the real split.
- **for_presentation** — With no app build it is just active (finished_at null). With an app build it runs for_app_build, which adds the feature-incomplete and remote-kill knockout columns, so the same split can serve different weights per build.
- **reassign_weight** — Builds a previous_split_registries row and assigns the new registry, but does not save. SplitUpsert calls it only when the merged registry differs from the current one (split_upsert.rb:12).
- **name_must_only_be_prefixed_with_app_name** — Runs only when the name changed. A one-part name is accepted unless require_app_name_prefix is set; the v2 migrations splits controller sets it.
- **name_contains_new?** — name_contains_new? and name_ends_with_test? have no callers under app/, lib/ or spec/.
