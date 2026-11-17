---
id: how-cors-works-for-the-js-client-corssupport-and-options-rou
type: flow
title: "how CORS works for the JS client (CorsSupport and OPTIONS routes)"
anchors:
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/api/cors_controller.rb","hash":"sha256:9d9240887c0d","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/cors_controller.rb","hash":"sha256:cda2e1286600","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:22:46.836Z
edits: 1
---

# how CORS works for the JS client (CorsSupport and OPTIONS routes)

CORS is opt-in per controller via `include CorsSupport` (an after_action) and every browser-facing resource needs an explicit `match 'x', to: '/api/v1/cors#allow', via: :options` route in config/routes.rb - there is no rack-cors. Origins are matched with `origin.end_with?(entry)` against comma-separated ENV WHITELIST_CORS_HOSTS, and the var is REQUIRED: any request on a CorsSupport controller raises if it is unset. Because it is suffix matching, an entry like 'example.org' also allows 'evilexample.org'.

## Steps

1. `app/controllers/concerns/cors_support.rb` (`CorsSupport`, `cors_allowed?`, `whitelisted_hosts`) — after_action adding Allow-Origin/Credentials headers; preflight adds methods/max-age
2. `config/routes.rb` (`match`) — per-endpoint OPTIONS routes pointing at cors#allow (v1 and v2 assignment_overrides)
3. `app/controllers/api/cors_controller.rb` (`Api::CorsController`) — returns 204 for preflight; Api::V1::CorsController is a duplicate

## Invariants

- New browser-called endpoint = include CorsSupport AND add an OPTIONS route
- Set WHITELIST_CORS_HOSTS in every environment that hits CorsSupport controllers (also tests)
