---
id: config-initializers-devise-rb-fc4baf98
type: file
character: hub
title: "config/initializers/devise.rb"
anchors:
  - {"path":"config/initializers/devise.rb","symbols":["config.omniauth :saml","config.sign_out_via"],"hash":"sha256:b8522e90e226","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.989Z
edits: 1
---

# config/initializers/devise.rb

## Facets

- **config.omniauth :saml** — Registered unconditionally, even when SAML_ISSUER is unset (values come from ENV.fetch with nil defaults); it becomes a route only when Admin adds :omniauthable. The IdP SSO URL is read from IDP_SSO_TARGET_URL, but config/environments/test.rb sets IDP_SSO_SERVICE_URL, so in the test env idp_sso_service_url is nil.
- **config.sign_out_via** — Set to :delete, matching the DELETE admins/sign_out route declared in config/routes.rb.
