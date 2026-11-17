---
id: how-an-api-request-is-authenticated-three-controller-base-cl
type: flow
title: "how an API request is authenticated (three controller base classes)"
anchors:
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_api_controller.rb","hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_admin_controller.rb","hash":"sha256:9c6276c26538","head":"435fea8235b5"}
  - {"path":"app/models/app.rb","hash":"sha256:6b6a97614e0d","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.829Z
edits: 1
---

# how an API request is authenticated (three controller base classes)

Auth is chosen by which base class a controller inherits, not by routes or filters: UnauthenticatedApiController (no auth, CSRF skipped, forces JSON), AuthenticatedApiController (HTTP Basic where username = App.name and password = App.auth_secret, sets current_app) and SharedSecretAuthenticatedApiController (HTTP Basic, any username, password = ENV BROWSER_EXTENSION_SHARED_SECRET, raises if unset). Client-facing endpoints (visitor configs, split registries, identifiers, assignment_events) are deliberately unauthenticated because browsers/mobile clients call them; only server-to-server mutation and lookup endpoints use app auth. A new controller that forgets the right parent is silently public.

## Steps

1. `app/controllers/unauthenticated_api_controller.rb` (`UnauthenticatedApiController`, `return_json`, `render_errors`) — root of all API controllers; skips CSRF, forces request.format=json, defines render_errors (422 with {errors:})
2. `app/controllers/authenticated_api_controller.rb` (`AuthenticatedApiController`, `authenticate`, `current_app`) — Basic auth against App name/auth_secret with secure_compare; failure is head :unauthorized
3. `app/controllers/shared_secret_authenticated_api_controller.rb` (`SharedSecretAuthenticatedApiController`) — chrome-extension override endpoints; one global secret, no per-app scoping
4. `app/controllers/authenticated_admin_controller.rb` (`AuthenticatedAdminController`) — admin UI base: Devise authenticate_admin!

## Invariants

- Authenticated endpoints scope data through current_app (e.g. current_app.splits.find_by!) - keep doing that
- App.auth_secret must be >=43 chars (App validation)
