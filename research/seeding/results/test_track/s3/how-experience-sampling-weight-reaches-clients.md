---
id: how-experience-sampling-weight-reaches-clients
type: flow
title: "how experience_sampling_weight reaches clients"
anchors:
  - {"path":"config/application.rb","hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/models/split_registry.rb","hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/app_visitor_configs/_show.json.jbuilder","hash":"sha256:c14723406673","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:58.110Z
edits: 1
---

# how experience_sampling_weight reaches clients

experience_sampling_weight is a boot-time config value and is only echoed in responses: no assignment-creating code reads it. config/application.rb reads EXPERIENCE_SAMPLING_WEIGHT (default 1) and raises at boot on a negative value, and the v4 controllers copy it into @experience_sampling_weight next to the active splits and visitor assignments. The jbuilder partial emits it at the top level of the response.

## Steps

1. `config/application.rb` (`experience_sampling_weight`) — reads the env var as an integer, raises when negative; the error text documents 0 as disabling experience events
2. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — sets @experience_sampling_weight alongside @active_splits and @assignments
3. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — same assignment of @experience_sampling_weight for the visitor config response
4. `app/controllers/api/v4/split_registries_controller.rb` (`show`) — builds a SplitRegistry from build_timestamp; the view reads the weight through it
5. `app/models/split_registry.rb` (`experience_sampling_weight`) — method wrapper around Rails.configuration.experience_sampling_weight used by the registry views
6. `app/views/api/v4/app_visitor_configs/_show.json.jbuilder` — emits experience_sampling_weight at top level, next to the splits and the visitor assignments

## Invariants

- The value is global for the process; it is not per split, per variant or per visitor.
- Negative values stop the app from booting; 0 is the documented way to disable experience events.
