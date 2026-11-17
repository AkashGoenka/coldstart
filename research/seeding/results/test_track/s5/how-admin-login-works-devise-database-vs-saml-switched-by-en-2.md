---
id: how-admin-login-works-devise-database-vs-saml-switched-by-en-2
type: flow
title: "how admin login works (Devise database vs SAML switched by ENV)"
anchors:
  - {"path":"app/models/admin.rb","hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_admin_controller.rb","hash":"sha256:9c6276c26538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:04.069Z
edits: 2
---

# how admin login works (Devise database vs SAML switched by ENV)

Admin auth mode is decided at boot by ENV SAML_ISSUER: when present, Admin includes Devise :omniauthable (provider :saml), routes add omniauth callbacks, and there is no password login; when absent, Admin is :database_authenticatable. Both Admin.devise_args and config/routes.rb branch on it, so changing the variable requires a restart and both places must agree. In SAML mode Admin.from_saml does find_or_initialize_by(email) followed by update!, which PERSISTS a new row, so any identity the IdP asserts becomes an admin on first login (access control is entirely in the IdP). There is no admin sign-up route; in database mode create admins from the console.

## Steps

1. `app/models/admin.rb` (`devise_args`, `from_saml`) — conditional Devise modules; from_saml find_or_initialize_by + update! persists new admins
2. `config/routes.rb` (`devise_for`) — conditional devise_for with omniauth_callbacks controller
3. `app/controllers/admins/omniauth_callbacks_controller.rb` (`saml`, `verify_admin`) — callback; skips CSRF for the SAML POST
4. `app/controllers/authenticated_admin_controller.rb` (`AuthenticatedAdminController`) — all admin pages inherit authenticate_admin!

## Invariants

- Every Admin::* controller must inherit AuthenticatedAdminController
- SAML_ISSUER must be consistent between model and routes (both read at boot)
