---
id: how-the-client-config-and-registry-endpoints-evolve-across-v
type: flow
title: "how the client config and registry endpoints evolve across v1 to v4"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/split_registries_controller.rb","hash":"sha256:06318cf68bfb","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/split_registries_controller.rb","hash":"sha256:955205cd8a92","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v3/split_registries_controller.rb","hash":"sha256:9b3d620ec198","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/models/split_registry.rb","hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/app_visitor_configs_controller.rb","hash":"sha256:17edc81d66c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
  - {"path":"app/views/api/v1/split_registries/show.json.jbuilder","hash":"sha256:4aec8f34c34b","head":"435fea8235b5"}
  - {"path":"app/views/api/v2/split_registries/show.json.jbuilder","hash":"sha256:ddb661939690","head":"435fea8235b5"}
  - {"path":"app/views/api/v3/split_registries/show.json.jbuilder","hash":"sha256:ddb661939690","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
  - {"path":"app/views/api/v1/app_visitor_configs/_show.json.jbuilder","hash":"sha256:daa93d83d527","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/app_visitor_configs/_show.json.jbuilder","hash":"sha256:c14723406673","head":"435fea8235b5"}
  - {"path":"config/application.rb","hash":"sha256:55ec8e883c9c","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:24.333Z
edits: 1
---

# how the client config and registry endpoints evolve across v1 to v4

Registry endpoints and config endpoints filter the same splits differently: SplitRegistry#splits is only Split.active(as_of:), so registries never apply the build's feature-gate or remote-kill knockouts, while config endpoints (v1 and v4 config, and the v4 identifier claim) use Split.for_presentation(app_build:) and do. Across versions the registry's time source changes from none (v1, unfinished splits only) to the server clock (v2) to build_timestamp (v3 and v4). experience_sampling_weight appears from v2 registries and v4 config, and v4 changes the split array shape.

## Steps

1. `config/routes.rb` (`split_registry`, `app_visitor_configs`, `app_identifiers`) — maps paths to versions: v1 and v2 registries are build-free singletons, v3 and v4 registries sit under builds/:timestamp, and v1 and v4 both route .../visitors/:visitor_id/config to a same-named controller in their own namespace
2. `app/controllers/api/v1/split_registries_controller.rb` (`show`) — v1 registry: Split.for_presentation with no build argument, so unfinished splits with no knockouts and no timestamp
3. `app/controllers/api/v2/split_registries_controller.rb` (`show`) — v2 registry: SplitRegistry.new(as_of: Time.zone.now), so the cut is the server clock at request time
4. `app/controllers/api/v3/split_registries_controller.rb` (`show`) — v3 registry: as_of from the build_timestamp path segment, 422 when it is invalid
5. `app/controllers/api/v4/split_registries_controller.rb` (`show`) — v4 registry: same controller logic as v3, rendered by the v4 view
6. `app/models/split_registry.rb` (`splits`, `experience_sampling_weight`) — splits = Split.active(as_of:), the bare time cut, so no for_app_build and no knockouts; the weight is forwarded from Rails.configuration
7. `app/models/split.rb` (`active`, `for_presentation`) — the cut itself: finished_at > as_of keeps a split; for_presentation adds for_app_build (knockouts) only when given a build
8. `app/controllers/api/v1/app_visitor_configs_controller.rb` (`show`) — v1 config: builds app_build from the path and calls Split.for_presentation(app_build:), so knockouts apply
9. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — v4 config: same computation as v1 plus @experience_sampling_weight
10. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — v4 identifier claim: saves the claim, then renders the v4 config partial for the claimed visitor
11. `app/views/api/v1/split_registries/show.json.jbuilder` (`show`) — v1 registry shape: flat hash of split name to weights; no feature_gate, no weight key
12. `app/views/api/v2/split_registries/show.json.jbuilder` (`splits`) — v2 registry shape: name-keyed hash of weights and feature_gate, plus experience_sampling_weight
13. `app/views/api/v4/split_registries/show.json.jbuilder` (`splits`) — v4 registry shape: splits as an array of name, variants [{name, weight}], feature_gate
14. `app/views/api/v1/app_visitor_configs/_show.json.jbuilder` (`splits`) — v1 config shape: name-keyed hash of weights; assignments include context and unsynced
15. `app/views/api/v4/app_visitor_configs/_show.json.jbuilder` (`splits`) — v4 config shape: same split array as v4 registry; assignments only split_name and variant; experience_sampling_weight at top level
16. `config/application.rb` (`experience_sampling_weight`) — boot-time source of the weight from EXPERIENCE_SAMPLING_WEIGHT

## Invariants

- Config and registry responses for the same build can disagree: a feature-gate or remote-killed split is knocked out in config (for_presentation with a build) but shows its stored weights in v2, v3 and v4 registries.
- Finished splits are cut at build_timestamp in v3, v4 registries and in config endpoints (finished_at > as_of keeps); v2 cuts at request time; the v1 registry keeps only unfinished splits.
- experience_sampling_weight is the same value for every v2+ registry and v4 config response, because it comes from Rails.configuration; v1 responses have no such key.
- The v4 identifier claim returns the v4 config shape, so a client that parses v4 config can parse it.
