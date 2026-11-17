---
id: app-controllers-concerns-cors-support-rb-b3a41238
type: file
character: single
title: "app/controllers/concerns/cors_support.rb"
anchors:
  - {"path":"app/controllers/concerns/cors_support.rb","symbols":["set_cors_headers","cors_allowed?"],"hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
status: active
updated: 2026-11-17T03:12:22.435Z
edits: 1
---

# app/controllers/concerns/cors_support.rb

set_cors_headers is an after_action on every including controller and calls cors_allowed? first, which reads ENV['WHITELIST_CORS_HOSTS'] and raises when it is unset, so a missing variable breaks responses from those controllers on every request, not only cross-origin ones. The check is origin.end_with? against each comma-separated entry, so an entry without a leading dot also matches longer hostnames ending in it, and a request with no Origin header never matches. When it passes, Access-Control-Allow-Origin echoes the request Origin and Allow-Credentials is true.
