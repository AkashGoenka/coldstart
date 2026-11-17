---
id: how-test-track-is-put-together
type: flow
title: "how test_track is put together"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/models/split_upsert.rb","hash":"sha256:bc70c7eb49a0","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:21:28.870Z
edits: 1
---

# how test_track is put together

TestTrack's server never decides a visitor's variant for client traffic: clients compute it locally from the split registry (MD5 of split name + visitor id), and the server only publishes registries/configs and records what was assigned, while admins and app migrations change weights that clients then see. There are four request surfaces, each with its own base controller: unauthenticated CORS-whitelisted visitor endpoints (UnauthenticatedApiController), per-App basic-auth endpoints for splits and migrations (AuthenticatedApiController), Chrome-extension shared-secret overrides (SharedSecretAuthenticatedApiController), and a Devise admin UI (AuthenticatedAdminController) whose long-running bulk assignments go through delayed_job. Routes keep every API version v1-v4 live side by side; most domain logic sits in non-ActiveRecord form objects (SplitUpsert, IdentifierClaim, *Creation, *Migration) rather than controllers.

## Steps

1. `config/routes.rb` — declares versioned API namespaces and swaps Devise routes on SAML_ISSUER
2. `app/controllers/unauthenticated_api_controller.rb` (`UnauthenticatedApiController`) — base for visitor-facing endpoints; forces JSON, skips CSRF
3. `app/models/split_upsert.rb` (`SplitUpsert`) — single write path for split config used by API and migrations
4. `app/models/arbitrary_assignment_creation.rb` (`ArbitraryAssignmentCreation`) — single write path for assignments with history
5. `app/models/split.rb` (`Split`) — registry weights plus build-scoped knockouts

## Invariants

- Registry weights per split sum to 100 and are integers
- Feature gates (split names ending _enabled) are never persisted as assignments
