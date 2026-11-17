---
id: app-models-split-rb-ba157a17
type: file
character: hub
title: "app/models/split.rb"
anchors:
  - {"path":"app/models/split.rb","symbols":["reassign_weight","name_must_only_be_prefixed_with_app_name","name_prefixed_other_than_app_name?","registry","reconfigure!","knock_out_weightings","active","arel_excluding_incomplete_features_for","for_presentation"],"hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:46.784Z
edits: 4
---

# app/models/split.rb

registry returns knocked-out weights (100 to the remote-kill or feature-incomplete variant, 0 elsewhere) only when the row carries the virtual attributes set by the for_app_build scope. Rows loaded any other way, including the assignment-event path, return the stored weights. So a remote kill changes what app builds are shown, not the bucket the server computes for a new assignment.

## Facets

- **reassign_weight** — Builds a PreviousSplitRegistry with the old registry, created_at set to the split's old updated_at and superseded_at set to now, then sets updated_at to now. The history row is persisted only by the enclosing split.save, so a failed upsert leaves no history.
- **name_must_only_be_prefixed_with_app_name** — Returns early unless name_changed?, so the app-prefix rule is enforced only on create or rename. An existing unprefixed split can still be reweighted through the v2 migrations endpoint.
- **name_prefixed_other_than_app_name?** — With require_app_name_prefix, a single-segment name is rejected; a two-segment name must match owner_app.name; three or more segments are always rejected.
- **registry** — Read-time knockout only: with remote_kill_override_to set (for_app_build), override_to gets 100 and the rest 0; with feature_incomplete set, the 'false' variant gets 100. The stored registry is not changed.
- **reconfigure!** — Goes through SplitUpsert, which clears decided_at and finished_at when the call omits them, so reconfiguring a retired split without passing finished_at reactivates it.
- **knock_out_weightings** — An override_to that is not a variant of the split is logged via log_knockout_error and the registry is returned unchanged, not an error.
- **active** — A split is retired when finished_at is set. active(as_of:) keeps splits finished after the build's built_at, so older builds still see a split that has since been retired.
- **arel_excluding_incomplete_features_for** — Non-gates pass (feature_gate = false). A gate passes only when an AppFeatureCompletion satisfied by the build exists for it.
- **for_presentation** — Without app_build it returns only unfinished splits with no knockouts (the v1 split_registries controller uses this). With a build it adds for_app_build.
