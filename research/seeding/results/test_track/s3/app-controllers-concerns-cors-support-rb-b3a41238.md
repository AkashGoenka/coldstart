---
id: app-controllers-concerns-cors-support-rb-b3a41238
type: file
character: single
title: "app/controllers/concerns/cors_support.rb"
anchors:
  - {"path":"app/controllers/concerns/cors_support.rb","symbols":["cors_allowed?","whitelisted_hosts","set_cors_headers"],"hash":"sha256:11ddeaefcb43","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.925Z
edits: 1
---

# app/controllers/concerns/cors_support.rb

cors_allowed? splits WHITELIST_CORS_HOSTS on commas and tests origin.end_with?(entry), so there is no dot boundary: entry myapp.example.org also admits evilmyapp.example.org. Preflight responses echo the requested headers and set Max-Age 3600; other responses echo the Origin with Allow-Credentials true. whitelisted_hosts raises when WHITELIST_CORS_HOSTS is unset.
