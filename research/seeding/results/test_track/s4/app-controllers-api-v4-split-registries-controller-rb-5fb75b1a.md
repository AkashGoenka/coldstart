---
id: app-controllers-api-v4-split-registries-controller-rb-5fb75b1a
type: file
character: single
title: "app/controllers/api/v4/split_registries_controller.rb"
anchors:
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","symbols":["show","split_registry_params"],"hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:38.322Z
edits: 1
---

# app/controllers/api/v4/split_registries_controller.rb

Identical to the v3 controller: it reads params[:build_timestamp] while config/routes.rb names the v4 builds segment :timestamp, so live requests get nil and 422. The only other difference is the view, which is in app/views/api/v4/split_registries/show.json.jbuilder, where splits is an array rather than a keyed object.
