---
id: how-a-browser-extension-assignment-override-gets-written
type: flow
title: "how a browser-extension assignment override gets written"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","hash":"sha256:3112f28d70df","head":"435fea8235b5"}
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/visitor.rb","hash":"sha256:27a2339a82a7","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.402Z
edits: 1
---

# how a browser-extension assignment override gets written

Override writes never consult force when deciding whether to supersede: any persisted assignment whose variant differs is superseded (the old row is copied to PreviousAssignment under a lock), and force is only stored on the new row, where the read side uses it to bypass the feature-gate filter. The v2 batch endpoint authenticates in a parent controller with a shared secret, takes the visitor from the URL, and writes every item inside one transaction.

## Steps

1. `config/routes.rb` (`assignment_overrides`) — v2 nested route /api/v2/visitors/:visitor_id/assignment_overrides; the v1 route reads visitor_id from the body instead
2. `app/controllers/shared_secret_authenticated_api_controller.rb` (`authenticate`) — HTTP basic password compared with BROWSER_EXTENSION_SHARED_SECRET before the action runs
3. `app/controllers/api/v2/assignment_overrides_controller.rb` (`create`, `create_params`) — merges force: true and hands the batch to BatchArbitraryAssignmentCreation; 204 on success
4. `app/models/batch_arbitrary_assignment_creation.rb` (`save!`) — one ActiveRecord transaction around the per-item writes
5. `app/models/arbitrary_assignment_creation.rb` (`save!`, `supersede!`) — supersedes when a persisted assignment's variant differs, otherwise inserts; retries save! after RecordNotUnique
6. `app/models/visitor.rb` (`from_id`) — the first item's lookup find-or-creates the visitor row for the visitor_id

## Invariants

- An unknown split_name raises inside the transaction, so every earlier item in the batch is rolled back.
- The supersede decision (superseding?) never reads force; changing that behaviour means changing ArbitraryAssignmentCreation.
- A malformed (non-UUID) visitor_id fails the lookup, because Visitor validates the id format on create.
