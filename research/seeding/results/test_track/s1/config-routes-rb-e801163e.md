---
id: config-routes-rb-e801163e
type: file
character: single
title: "config/routes.rb"
anchors:
  - {"path":"config/routes.rb","symbols":["split_registry","app_visitor_configs","app_identifiers"],"hash":"sha256:587252ce1c26","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.347Z
edits: 1
---

# config/routes.rb

The client endpoints are not one versioned tree: v1 and v2 split_registry are singleton routes with no build in the path, v3 and v4 registries live under builds/:timestamp, and v1 and v4 both route .../visitors/:visitor_id/config to a controller with the same name in their own namespace. The v4 identifier claim is a POST to .../builds/:timestamp/identifier. So a version difference in the response is mostly decided by which controller a path resolves to, not by a parameter.
