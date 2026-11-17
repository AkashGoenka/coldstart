---
id: how-a-split-migration-request-becomes-a-split-row-and-what-i
type: flow
title: "how a split migration request becomes a split row and what it keeps"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/migrations/splits_controller.rb","hash":"sha256:7d708a75a8be","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:25:33.850Z
edits: 1
---

# how a split migration request becomes a split row and what it keeps

A migration create never clears an existing split's owner and never deletes variants from its registry: an omitted owner is nil and is skipped, and submitted weights are merged over the existing registry with unlisted variants set to 0. The request reaches SplitUpsert through the controller's permitted params, so a newly permitted key also has to be an attr_accessor on SplitUpsert. The controller, not the caller, supplies the app and require_app_name_prefix.

## Steps

1. `config/routes.rb` (`split`) — POST route for the migrations collection's singular split resource, served by the migrations splits controller
2. `app/controllers/api/v2/migrations/splits_controller.rb` (`create`, `create_params`) — authenticated by the app's basic-auth credentials, permits name, owner and the weighting registry, and builds SplitUpsert from them
3. `app/models/split_upsert.rb` (`save`, `merged_registry`) — assigns owner only when it is non-nil, merges the weights over the existing registry, validates, then saves

## Invariants

- Omitting owner leaves the existing owner unchanged; only nil is skipped, so an empty string would be assigned.
- Variants missing from the submitted weights keep their key with weight 0 when the split already exists.
- Every key in create_params must be an attr_accessor on SplitUpsert, because the controller passes the params straight into SplitUpsert.new.
