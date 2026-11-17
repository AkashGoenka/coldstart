---
id: how-admin-sign-in-works-saml-or-database-chosen-at-boot
type: flow
title: "how admin sign-in works (SAML or database, chosen at boot)"
anchors:
  - {"path":"config/routes.rb","hash":"sha256:587252ce1c26","head":"435fea8235b5"}
  - {"path":"app/models/admin.rb","hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
  - {"path":"config/initializers/devise.rb","hash":"sha256:b8522e90e226","head":"435fea8235b5"}
  - {"path":"app/views/admin/sessions/new.html.erb","hash":"sha256:03cf7a1a9d1f","head":"435fea8235b5"}
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
  - {"path":"app/controllers/admin/sessions_controller.rb","hash":"sha256:4b68f8b72837","head":"435fea8235b5"}
  - {"path":"app/controllers/authenticated_admin_controller.rb","hash":"sha256:9c6276c26538","head":"435fea8235b5"}
  - {"path":"app/controllers/application_controller.rb","hash":"sha256:39425dbe4a7c","head":"435fea8235b5"}
  - {"path":"spec/models/admin_spec.rb","hash":"sha256:80015f58b70b","head":"435fea8235b5"}
  - {"path":"config/environments/test.rb","hash":"sha256:ec440c144410","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.967Z
edits: 1
---

# how admin sign-in works (SAML or database, chosen at boot)

The SAML-or-database choice is made once at boot by whether SAML_ISSUER is set, and three files must read it the same way (routes.rb, Admin.devise_args, and the :saml omniauth provider in devise.rb). A first SAML login creates the Admin row: from_saml does find_or_initialize_by(email:) followed by update!, so no pre-existing admin is required. The flow is: the sign-in page button POSTs to the omniauth path, the IdP response reaches Admins::OmniauthCallbacksController#saml, Admin.from_saml upserts by email, and Devise signs the admin in; every admin UI controller is gated by before_action :authenticate_admin! inherited from AuthenticatedAdminController.

## Steps

1. `config/routes.rb` (`new_admin_session`, `destroy_admin_session`) — ENV['SAML_ISSUER'] branch: SAML mode mounts devise_for :admins with the custom callbacks controller and hand-declares admins/sign_in (to admin/sessions#new) and admins/sign_out; database mode is a bare devise_for :admins with no admin/sessions route
2. `app/models/admin.rb` (`devise_args`, `from_saml`) — the same ENV check picks the Devise modules: omniauthable with saml, or database_authenticatable; from_saml is the upsert the callback calls
3. `config/initializers/devise.rb` (`Devise.setup`) — registers the :saml omniauth provider from ENV at boot; whether it is routed is decided by the module list on Admin
4. `app/views/admin/sessions/new.html.erb` — the login button: POST to omniauth_authorize_path(:admin, :saml)
5. `app/controllers/admins/omniauth_callbacks_controller.rb` (`saml`, `verify_admin`) — receives the IdP response, calls Admin.from_saml, signs in and redirects when the result is persisted, otherwise flashes and returns to sign-in
6. `app/controllers/admin/sessions_controller.rb` (`Admin::SessionsController`) — sign-in page controller: an empty subclass of Devise::SessionsController, so the page is its new action rendering the SAML button
7. `app/controllers/authenticated_admin_controller.rb` (`AuthenticatedAdminController`) — base class for every admin UI controller: before_action :authenticate_admin!

## Invariants

- SAML_ISSUER is read at boot by routes.rb, Admin.devise_args and devise.rb; changing it requires a restart, and the three reads must agree or the routes and models disagree
- A first SAML login creates an Admin row keyed by the downcased SAML uid; nothing in the login path restricts which IdP identities get a row
- admins.uid is never written by the app, so its unique index does not identify SAML users
- config/environments/test.rb sets SAML_ISSUER, so the suite runs the SAML branch
