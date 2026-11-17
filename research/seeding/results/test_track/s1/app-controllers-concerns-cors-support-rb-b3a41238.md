---
id: app-controllers-concerns-cors-support-rb-b3a41238
type: file
character: single
title: "app/controllers/concerns/cors_support.rb"
anchors:
  - {"path":"app/controllers/concerns/cors_support.rb","symbols":["CorsSupport","set_cors_headers","cors_allowed?","whitelisted_hosts"],"hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:30.102Z
edits: 1
---

# app/controllers/concerns/cors_support.rb

CORS is opt-in per controller: an after_action that only runs on controllers that `include CorsSupport` (15 do, per grep; the base classes do not). `set_cors_headers` calls `cors_allowed?` unconditionally, so an unset WHITELIST_CORS_HOSTS raises on every request to those controllers, including requests with no Origin header. The match is `origin.end_with?(entry)` for each comma-split entry, with no dot boundary, so `myapp.example.org` also admits `notmyapp.example.org`; development.rb uses `.dev` with a leading dot for this reason. Allow-Origin reflects the request Origin, with credentials true. On OPTIONS, Allow-Headers echoes the request's Access-Control-Request-Headers and Max-Age is 3600.
