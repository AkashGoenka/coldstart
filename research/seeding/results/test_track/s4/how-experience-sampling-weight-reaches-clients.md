---
id: how-experience-sampling-weight-reaches-clients
type: flow
title: "how EXPERIENCE_SAMPLING_WEIGHT reaches clients"
anchors:
  - {"path":"config/application.rb","hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
  - {"path":"app/models/split_registry.rb","hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
  - {"path":"app/views/api/v2/split_registries/show.json.jbuilder","hash":"sha256:ddb661939690","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/split_registries_controller.rb","hash":"sha256:06318cf68bfb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:38.311Z
edits: 1
---

# how EXPERIENCE_SAMPLING_WEIGHT reaches clients

The weight is read from the EXPERIENCE_SAMPLING_WEIGHT env var once, at boot, in config/application.rb, where a negative value raises and stops the app from starting; no request re-reads ENV. It reaches clients through two routes: the split registry views (v2, v3, v4 render SplitRegistry#experience_sampling_weight, which returns Rails.configuration's value) and the v4 assignment endpoints, which set @experience_sampling_weight from Rails.configuration in the controller. The v1 split registry carries no weight at all.

## Steps

1. `config/application.rb` (`experience_sampling_weight`) — parses and validates the env var at boot (default 1); this is the only place the env var is read
2. `app/models/split_registry.rb` (`experience_sampling_weight`) — returns Rails.configuration.experience_sampling_weight to the split registry views
3. `app/views/api/v2/split_registries/show.json.jbuilder` (`experience_sampling_weight`) — emits the weight at the top level of the v2 split registry response
4. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — copies Rails.configuration.experience_sampling_weight into @experience_sampling_weight for the per-visitor config response
5. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — same copy for the identifier-claim response
6. `app/controllers/api/v1/split_registries_controller.rb` (`show`) — v1 sets only @active_splits, so v1 responses have no experience_sampling_weight

## Invariants

- weight 0 disables experience reporting and a value of 10 means one in ten, so every consumer must read the same boot-time value
- tests stub Rails.configuration.experience_sampling_weight, not ENV, so changing the env read path breaks the stubs without failing any test that reads ENV
