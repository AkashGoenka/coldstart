---
id: app-views-api-v4-split-registries-show-json-jbuilder-19e7212d
type: file
character: single
title: "app/views/api/v4/split_registries/show.json.jbuilder"
anchors:
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","symbols":["SplitRegistry"],"hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:38.327Z
edits: 1
---

# app/views/api/v4/split_registries/show.json.jbuilder

Emits splits as an array of objects with name, variants (an array of name and weight pairs) and feature_gate, where the v2 and v3 views emit an object keyed by split name. A client that switches from v3 to v4 has to parse a different shape for the same registry. experience_sampling_weight is set by the model method as in v2 and v3.
