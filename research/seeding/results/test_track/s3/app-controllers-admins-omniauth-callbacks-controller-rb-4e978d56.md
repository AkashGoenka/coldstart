---
id: app-controllers-admins-omniauth-callbacks-controller-rb-4e978d56
type: file
character: single
title: "app/controllers/admins/omniauth_callbacks_controller.rb"
anchors:
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","symbols":["saml","verify_admin"],"hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:05.968Z
edits: 1
---

# app/controllers/admins/omniauth_callbacks_controller.rb

skip_before_action :verify_authenticity_token applies only to the saml action, which is the one POST that comes from the IdP. verify_admin signs in only a persisted Admin and only flashes the success notice when active_for_authentication? is true; otherwise it flashes 'Unable to sign in!' and redirects to new_admin_session_path.
