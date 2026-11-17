---
id: config-routes-rb-e801163e
type: file
character: hub
title: "config/routes.rb"
anchors:
  - {"path":"config/routes.rb","symbols":["identifier","assignment_overrides"],"hash":"sha256:587252ce1c26","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.471Z
edits: 1
---

# config/routes.rb

## Facets

- **identifier** — The v4 identifier route sits under apps/:name/versions/:number/builds/:timestamp and has no match ... via: :options preflight, unlike the v1 identifier route; its controller includes CorsSupport anyway. The path segment is :name, while the controller reads app_name from params, so the path never supplies it.
- **assignment_overrides** — The v2 nested override route takes visitor_id from the path, while the v1 override route reads it from the body; each needs its own OPTIONS match pointing at Api::V1::CorsController#allow.
