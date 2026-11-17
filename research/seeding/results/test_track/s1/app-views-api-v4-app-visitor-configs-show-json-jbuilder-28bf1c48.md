---
id: app-views-api-v4-app-visitor-configs-show-json-jbuilder-28bf1c48
type: file
character: single
title: "app/views/api/v4/app_visitor_configs/_show.json.jbuilder"
anchors:
  - {"path":"app/views/api/v4/app_visitor_configs/_show.json.jbuilder","symbols":["splits","experience_sampling_weight"],"hash":"sha256:c14723406673","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.419Z
edits: 1
---

# app/views/api/v4/app_visitor_configs/_show.json.jbuilder

The v4 wire format: splits is an array of {name, variants: [{name, weight}], feature_gate}, not a name-keyed map, which is the same split shape the v4 registry uses. visitor.assignments carries only split_name and variant. experience_sampling_weight sits at the top level beside splits and visitor. The v4 identifier claim renders this same partial, so its response has this shape too.
