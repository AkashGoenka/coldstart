---
id: how-api-requests-are-authenticated-per-endpoint
type: flow
title: "how API requests are authenticated per endpoint"
anchors:
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_api_controller.rb","hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_events_controller.rb","hash":"sha256:d6683d9b4b35","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:34.053Z
edits: 1
---

# how API requests are authenticated per endpoint

There is no global auth filter: each endpoint's auth comes from the base controller it inherits, and ApplicationController adds none. The one endpoint that writes assignments, Api::V1::AssignmentEventsController, inherits the unauthenticated base, so it has no credential check at all, while the assignment override controller next to it requires the shared secret. Basic auth means different things per base: an app name plus app secret, or only the shared secret with the username ignored.

## Steps

1. `app/controllers/unauthenticated_api_controller.rb` (`UnauthenticatedApiController`) — no credential check; skips verify_authenticity_token and forces JSON format. Base of the v1 events, identifiers and registries endpoints and of the v3 and v4 controllers.
2. `app/controllers/authenticated_api_controller.rb` (`authenticate`) — HTTP Basic with username = App name and password compared to app.auth_secret; on success sets @current_app, otherwise 401.
3. `app/controllers/shared_secret_authenticated_api_controller.rb` (`authenticate`, `shared_secret`) — HTTP Basic password compared to ENV BROWSER_EXTENSION_SHARED_SECRET (username ignored); raises when the variable is blank instead of answering 401.
4. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — shared-secret gated; calls ArbitraryAssignmentCreation with force: true, so it can supersede an existing assignment.
5. `app/controllers/api/v1/assignment_events_controller.rb` (`create`) — inherits UnauthenticatedApiController: unlike the override controller above, nothing checks a credential before it writes an assignment.

## Invariants

- Api::V1::SplitConfigsController, SplitDetailsController, IdentifierTypesController, VisitorDetailsController and Api::V2::MigrationsController (plus its Migrations:: controllers) inherit AuthenticatedApiController, i.e. app basic auth.
- Api::V1::AssignmentOverridesController and Api::V2::AssignmentOverridesController inherit SharedSecretAuthenticatedApiController, so they are the only assignment writers behind a credential.
- SharedSecretAuthenticatedApiController does not inherit AuthenticatedApiController; an app secret is not accepted on the override endpoints.
