---
id: how-a-chrome-extension-assignment-override-is-authenticated
type: flow
title: "how a Chrome extension assignment override is authenticated and written"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/shared_secret_authenticated_api_controller.rb","hash":"sha256:368a96aee8c2","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v2/assignment_overrides_controller.rb","hash":"sha256:3112f28d70df","head":"435fea8235b5"}
  - {"path":"app/models/batch_arbitrary_assignment_creation.rb","hash":"sha256:4bda65f2376a","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/controllers/concerns/cors_support.rb","hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v1/cors_controller.rb","hash":"sha256:cda2e1286600","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.920Z
edits: 1
---

# how a Chrome extension assignment override is authenticated and written

The override endpoints use no user authentication: one shared secret, sent as HTTP Basic with the username ignored, gates the write, and every write passes force: true. The Origin allow-list for these routes is a raw string suffix match, not a host match. The code does not record why a shared secret was chosen over user sessions.

## Steps

1. `config/routes.rb` (`assignment_override`, `assignment_overrides`) — v1 maps POST /api/v1/assignment_override and an OPTIONS preflight to cors#allow; v2 nests POST /api/v2/visitors/:visitor_id/assignment_overrides under visitors
2. `app/controllers/shared_secret_authenticated_api_controller.rb` (`authenticate`, `shared_secret`) — before_action: secure_compare of ENV BROWSER_EXTENSION_SHARED_SECRET against the Basic password; raises instead of returning 401 when that variable is unset or blank
3. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — single override: ArbitraryAssignmentCreation.create! with force: true
4. `app/controllers/api/v2/assignment_overrides_controller.rb` (`create`) — batch override: BatchArbitraryAssignmentCreation.create! with an assignments array and force: true
5. `app/models/batch_arbitrary_assignment_creation.rb` (`save!`) — runs each assignment inside one transaction and forces mixpanel_result 'success'
6. `app/models/arbitrary_assignment_creation.rb` (`save!`, `supersede!`) — a changed variant on an existing assignment goes through supersede!, which keeps a PreviousAssignment row and sets individually_overridden
7. `app/controllers/concerns/cors_support.rb` (`cors_allowed?`, `whitelisted_hosts`, `add_common_cors_headers`) — after_action: Origin must end with one WHITELIST_CORS_HOSTS entry; the Origin is echoed back with Allow-Credentials true
8. `app/controllers/api/v1/cors_controller.rb` (`allow`) — target of the OPTIONS preflight routes; returns 204 and lets CorsSupport add the headers

## Invariants

- The shared secret is the only authentication on these endpoints, and the Basic username is ignored.
- Every override write is force: true, and no controller in this path checks a current user.
- The CORS allow-list is a suffix match on the raw Origin string, so a whitelist entry also admits any Origin ending in it.
