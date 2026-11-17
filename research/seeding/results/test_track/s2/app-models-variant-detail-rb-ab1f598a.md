---
id: app-models-variant-detail-rb-ab1f598a
type: file
character: single
title: "app/models/variant_detail.rb"
anchors:
  - {"path":"app/models/variant_detail.rb","symbols":["retirable?","assignment_count","display_name"],"hash":"sha256:b8ec0ea63583","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:34.025Z
edits: 1
---

# app/models/variant_detail.rb

`retirable?` is true only when the variant's weight is zero and `assignment_count` is positive, so a zero-weight variant that nobody was ever assigned to is not retirable. `weight` and `assignment_count` are memoized per instance (`@weight ||=`, `@assignment_count ||=`), so a long-lived object keeps returning its first-read values after the split's weights change. `display_name` falls back to the `variant` column only when the stored value is nil. `variant_must_exist` checks against `split.has_variant?`, so a detail row cannot be saved for a variant the split does not have.
