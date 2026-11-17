---
id: how-api-versions-v1-v4-relate-and-which-one-clients-use
type: flow
title: "how API versions v1-v4 relate and which one clients use"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/app_visitor_configs/show.json.jbuilder","hash":"sha256:fa840855a831","head":"435fea8235b5"}
  - {"path":"app/views/api/v1/split_registries/show.json.jbuilder","hash":"sha256:4aec8f34c34b","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/app_visitor_configs_controller.rb","hash":"sha256:17edc81d66c2","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.876Z
edits: 1
---

# how API versions v1-v4 relate and which one clients use

Versions coexist rather than replace each other: all routes remain live and old controllers are never removed because shipped mobile/JS clients pin them. v1 = original visitor/identifier/assignment endpoints plus per-app configs and authenticated server-side endpoints (split_configs, split_details, identifier_type); v2 = split_registry (current time), batch assignment overrides and the `migrations` resources used by the Rails client's migration files; v3/v4 take a build_timestamp so the registry/config is as-of that build; v4 additionally returns experience_sampling_weight and has a combined identifier-claim-plus-config endpoint (apps/:app/versions/:v/builds/:ts/identifier). JSON shapes live in app/views/api/**.jbuilder, not in controllers, and v1 split_registries renders {split_name => registry} while v3/v4 render a splits array with feature_gate flags.

## Steps

1. `config/routes.rb` (`namespace`) — all versions under /api
2. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — newest claim+config endpoint
3. `app/controllers/api/v4/split_registries_controller.rb` (`show`) — as_of registry; 422 if timestamp not ISO8601
4. `app/views/api/v4/app_visitor_configs/show.json.jbuilder` (`json`) — the response shape clients parse

## Invariants

- Don't change v1-v3 JSON shapes
- Timestamps must match the ISO8601 regex in SplitRegistry/AppVersionBuildPath (seconds or ms precision, with zone)
