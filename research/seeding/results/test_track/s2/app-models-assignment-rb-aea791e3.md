---
id: app-models-assignment-rb-aea791e3
type: file
character: hub
title: "app/models/assignment.rb"
anchors:
  - {"path":"app/models/assignment.rb","symbols":["for_presentation","excluding_incomplete_features_for","excluding_remote_kills_for","create_previous_assignment!","variant_must_exist","unsynced?"],"hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:04.348Z
edits: 1
---

# app/models/assignment.rb

## Facets

- **for_presentation** — With no app build it drops decision overrides: a row survives only if its split is undecided or the row's updated_at is later than split.decided_at. So an assignment made before a split was decided stops being presented.
- **excluding_incomplete_features_for** — Keeps rows with force = true even when the split's feature gate is incomplete for that build. force is the bypass.
- **excluding_remote_kills_for** — Drops rows whose split has a remote kill affecting that build. Only the build-scoped path checks kills; the no-build path does not.
- **create_previous_assignment!** — Copies the current row into previous_assignments with created_at taken from this row's updated_at and both updated_at and superseded_at set to the given time. Variant, force, context and individually_overridden are carried over.
- **variant_must_exist** — Checks the variant against the split's current registry, so once a variant is removed from a split, saving an existing assignment on it fails validation.
- **unsynced?** — True when mixpanel_result is nil or 'failure'; 'success' is the only synced state.
