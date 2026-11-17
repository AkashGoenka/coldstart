---
id: how-api-requests-are-authenticated-and-get-cors-headers
type: flow
title: "how API requests are authenticated and get CORS headers"
anchors:
  - {"path":"app/controllers/application_controller.rb","hash":"sha256:39425dbe4a7c","head":"435fea8235b5"}
  - {"path":"app/controllers/unauthenticated_api_controller.rb","hash":"sha256:27996adc688e","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_api_controller.rb","hash":"sha256:4a12f75d2534","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/cors_controller.rb","hash":"sha256:cda2e1286600","head":"435fea8235b5"}
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/identifier_visitors_controller.rb","hash":"sha256:ae02130e64b0","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.076Z
edits: 1
---

# how API requests are authenticated and get CORS headers

Auth and CORS are chosen per controller by its base class and by whether it declares `include CorsSupport`; there is no global filter. UnauthenticatedApiController does no auth at all, and the base classes never include CorsSupport, so a controller gets CORS headers only when it opts in itself. Three bases: visitor/SDK endpoints (unauthenticated), server-to-server endpoints (HTTP basic with the App name and auth_secret), and the Chrome-extension override endpoints (HTTP basic whose password is BROWSER_EXTENSION_SHARED_SECRET). Preflight is path-routed: each OPTIONS path listed in routes.rb goes to Api::V1::CorsController#allow, which returns 204, and the headers come from CorsSupport.

## Steps

1. `app/controllers/application_controller.rb` (`ApplicationController`) — root base; enables protect_from_forgery, which UnauthenticatedApiController then skips
2. `app/controllers/unauthenticated_api_controller.rb` (`UnauthenticatedApiController`) — base for visitor/SDK endpoints: skips CSRF and forces JSON, with no authentication
3. `app/controllers/authenticated_api_controller.rb` (`authenticate`) — server-to-server branch: HTTP basic, App looked up by name and compared to auth_secret
4. `app/controllers/shared_secret_authenticated_api_controller.rb` (`authenticate`) — extension branch: HTTP basic where only the password is compared to BROWSER_EXTENSION_SHARED_SECRET; raises if unset
5. `app/controllers/api/v1/assignment_overrides_controller.rb` (`Api::V1::AssignmentOverridesController`) — example of the shared-secret base combined with include CorsSupport (v2 is the same pattern)
6. `app/controllers/concerns/cors_support.rb` (`set_cors_headers`, `cors_allowed?`, `whitelisted_hosts`) — after_action that reflects Origin when it suffix-matches WHITELIST_CORS_HOSTS and adds preflight headers on OPTIONS
7. `app/controllers/api/v1/cors_controller.rb` (`allow`) — OPTIONS sink: returns 204 with no body; CORS headers are added only by the included concern
8. `config/routes.rb` — declares which paths answer OPTIONS (via: :options, all pointing to cors#allow); v1 and v2 assignment_overrides are listed, v2 split_registry and v3/v4 CORS endpoints are not
9. `app/controllers/api/v1/identifier_visitors_controller.rb` (`Api::V1::IdentifierVisitorsController`) — unauthenticated endpoint with no CorsSupport and no OPTIONS route, so browsers get no Allow-Origin on it

## Invariants

- A browser-callable endpoint needs three things: an inheriting base, an explicit `include CorsSupport`, and an OPTIONS route in routes.rb if it takes non-simple requests. The base classes provide none of the CORS part.
- CorsSupport#set_cors_headers calls whitelisted_hosts unconditionally, so an unset WHITELIST_CORS_HOSTS raises on every request to an including controller, even one with no Origin header.
- BROWSER_EXTENSION_SHARED_SECRET unset or blank raises in the before_action, which is a server error, not a 401.
- Origin matching is a bare end_with? against each comma-separated entry, with no dot boundary; a host entry without a leading dot also admits look-alike hosts (development.rb defaults to '.dev' for this reason).
