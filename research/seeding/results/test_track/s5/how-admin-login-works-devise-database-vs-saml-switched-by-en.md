---
id: how-admin-login-works-devise-database-vs-saml-switched-by-en
type: flow
title: "how admin login works (Devise database vs SAML switched by ENV)"
anchors:
  - {"path":"app/models/admin.rb","hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_admin_controller.rb","hash":"sha256:9c6276c26538","head":"435fea8235b5"}
status: retracted
updated: 2026-11-16T18:23:04.051Z
edits: 2
---

# how admin login works (Devise database vs SAML switched by ENV)

> Retracted — kept for history; do not rely on this note.

Admin auth mode is decided at boot by ENV SAML_ISSUER: when present, Admin includes Devise :omniauthable (provider :saml), routes add omniauth callbacks, and there is no password login; when absent, Admin is :database_authenticatable. Both Admin.devise_args and config/routes.rb branch on it, so changing the variable requires a restart and both places must agree. SAML sign-in does not create admins: Admin.from_saml uses find_or_initialize_by(email) and the callback only signs in if the record is persisted, so an unknown email gets 'Unable to sign in!' - but note update! on a new record persists it, so verify against actual behaviour before relying on this. There is no admin sign-up route; create admins from the console/seeds.

## Steps

1. `app/models/admin.rb` (`devise_args`, `from_saml`) — conditional Devise modules (+ trackable, lockable, timeoutable)
2. `config/routes.rb` (`devise_for`) — conditional devise_for with omniauth_callbacks controller
3. `app/controllers/admins/omniauth_callbacks_controller.rb` (`saml`, `verify_admin`) — callback; skips CSRF for the SAML POST
4. `app/controllers/authenticated_admin_controller.rb` (`AuthenticatedAdminController`) — all admin pages inherit authenticate_admin!

## Invariants

- Every Admin::* controller must inherit AuthenticatedAdminController
