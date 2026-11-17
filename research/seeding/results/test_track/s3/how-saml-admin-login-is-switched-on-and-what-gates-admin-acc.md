---
id: how-saml-admin-login-is-switched-on-and-what-gates-admin-acc
type: flow
title: "how SAML admin login is switched on and what gates admin access"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"config/initializers/devise.rb","hash":"sha256:b8522e90e226","head":"435fea8235b5"}
  - {"path":"app/models/admin.rb","hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_admin_controller.rb","hash":"sha256:9c6276c26538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.947Z
edits: 1
---

# how SAML admin login is switched on and what gates admin access

SAML_ISSUER is read in three places (config/routes.rb, config/initializers/devise.rb, Admin.devise_args) and the omniauth :saml strategy is registered unconditionally. There is no allow-list: Admin.from_saml creates and saves an Admin row for any email the IdP asserts, so the IdP is the only gate on who becomes an admin. Inside the admin namespace, AuthenticatedAdminController's before_action :authenticate_admin! is the sole enforcement.

## Steps

1. `config/routes.rb` (`devise_for`, `new_admin_session`) — when SAML_ISSUER is present, mounts omniauth_callbacks to Admins::OmniauthCallbacksController and maps admins/sign_in to Admin::SessionsController; otherwise plain devise_for :admins (password login)
2. `config/initializers/devise.rb` (`omniauth`) — config.omniauth :saml with ENV.fetch of SAML_ISSUER, IDP_SSO_TARGET_URL and IDP_CERT_FINGERPRINT, with no SAML_ISSUER guard, so the strategy exists even when the model and routes are in password mode
3. `app/models/admin.rb` (`devise_args`, `from_saml`, `lookup_admin`) — devise modules are chosen at class load: omniauthable with saml when SAML_ISSUER is present, database_authenticatable otherwise; from_saml find-or-initializes by the downcased SAML uid and update!s name and provider, which persists the row on first login
4. `app/controllers/admins/omniauth_callbacks_controller.rb` (`saml`, `verify_admin`) — POST callback that skips CSRF only for saml; signs the admin in when the record is persisted, otherwise flashes 'Unable to sign in!' and redirects to the sign-in page
5. `app/controllers/authenticated_admin_controller.rb` (`AuthenticatedAdminController`, `authenticate_admin!`) — the admin namespace's only gate: every Admin:: controller I checked inherits it, and the sign-in and omniauth controllers do not

## Invariants

- Any email the IdP asserts becomes an Admin with provider SAML on first login.
- A new controller in the Admin namespace is unprotected unless it inherits AuthenticatedAdminController rather than ApplicationController.
- SAML login and password login are mutually exclusive per boot: the same SAML_ISSUER check decides both the routes and the Admin modules.
