---
id: no-admin-allow-list-or-domain-check-on-saml-login
type: lesson
kind: absence
title: "no admin allow-list or domain check on SAML login"
scope: {"terms":["allowlist","allowed_domain","from_saml","verify_admin"]}
status: active
updated: 2026-11-16T18:24:05.972Z
edits: 1
---

# no admin allow-list or domain check on SAML login

Searched config/initializers/devise.rb, app/models/admin.rb, app/controllers/admins/omniauth_callbacks_controller.rb and app/controllers/authenticated_admin_controller.rb for allow-list, allowed_domain and domain checks: none. The only check on a SAML identity is Admin.from_saml plus persisted? in verify_admin, so any email the configured IdP authenticates gets admin access.

## Scope (absence — freshness = re-run this search)

- terms: `allowlist`, `allowed_domain`, `from_saml`, `verify_admin`
