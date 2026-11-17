---
id: app-models-admin-rb-dfae316f
type: file
character: single
title: "app/models/admin.rb"
anchors:
  - {"path":"app/models/admin.rb","symbols":["from_saml","devise_args"],"hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.962Z
edits: 1
---

# app/models/admin.rb

from_saml is the only place a SAML login turns into an Admin: it find-or-initializes by the downcased SAML uid, then update!s full_name and provider, so the first successful assertion saves a new row and there is no allow-list check. devise_args runs once when the class loads, so SAML_ISSUER is read at boot, not per request.
