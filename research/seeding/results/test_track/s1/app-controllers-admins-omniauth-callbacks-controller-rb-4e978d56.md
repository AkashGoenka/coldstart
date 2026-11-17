---
id: app-controllers-admins-omniauth-callbacks-controller-rb-4e978d56
type: file
character: single
title: "app/controllers/admins/omniauth_callbacks_controller.rb"
anchors:
  - {"path":"app/controllers/admins/omniauth_callbacks_controller.rb","symbols":["saml","verify_admin","new_session_path"],"hash":"sha256:94639a41eaaf","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.984Z
edits: 1
---

# app/controllers/admins/omniauth_callbacks_controller.rb

saml is the only action: it passes Admin.from_saml(request.env['omniauth.auth']) to verify_admin, which signs in only when the result is persisted and otherwise flashes 'Unable to sign in!' and redirects to new_admin_session_path. The active_for_authentication? check only decides whether the success flash shows; this controller does not itself refuse an inactive or locked admin. CSRF verification is skipped for saml alone, since the IdP's POST carries no token. The new_session_path override returns new_admin_session_path.
