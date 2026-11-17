---
id: how-a-cors-enabled-api-response-gets-its-headers-and-preflig
type: flow
title: "how a CORS-enabled API response gets its headers and preflight"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/cors_controller.rb","hash":"sha256:cda2e1286600","head":"435fea8235b5"}
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_identifiers_controller.rb","hash":"sha256:76aeda829de8","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.418Z
edits: 1
---

# how a CORS-enabled API response gets its headers and preflight

Preflight answers are not generated from controllers: each OPTIONS path is declared by hand in config/routes.rb and routed to Api::V1::CorsController#allow, while the real headers come from an after_action in CorsSupport that reads WHITELIST_CORS_HOSTS on every request. The v4 identifier and config routes have no preflight declaration, although their controllers include CorsSupport.

## Steps

1. `config/routes.rb` (`allow`) — match ... via: :options declarations; the v4 identifier and config routes have none
2. `app/controllers/api/v1/cors_controller.rb` (`allow`) — returns 204; CorsSupport adds the headers to it
3. `app/controllers/concerns/cors_support.rb` (`set_cors_headers`, `cors_allowed?`) — after_action; reads WHITELIST_CORS_HOSTS and raises when it is unset
4. `app/controllers/api/v4/app_identifiers_controller.rb` (`create`) — includes CorsSupport but its route has no preflight declaration

## Invariants

- WHITELIST_CORS_HOSTS must be set wherever these controllers run; when unset, every response from a CorsSupport controller raises.
- Matching is suffix-based (origin.end_with?), so an entry without a leading dot also matches longer hostnames that end in it.
- Access-Control-Allow-Origin echoes the request Origin and Allow-Credentials is true.
