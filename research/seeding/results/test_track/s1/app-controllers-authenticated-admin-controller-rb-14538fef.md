---
id: app-controllers-authenticated-admin-controller-rb-14538fef
type: file
character: single
title: "app/controllers/authenticated_admin_controller.rb"
anchors:
  - {"path":"app/controllers/authenticated_admin_controller.rb","symbols":["AuthenticatedAdminController"],"hash":"sha256:9c6276c26538","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.996Z
edits: 1
---

# app/controllers/authenticated_admin_controller.rb

This is the only place admin UI access is enforced: before_action :authenticate_admin! is inherited by the nine Admin:: controllers (splits, split_details, split_assignments, split_configs, bulk_assignments, decisions, variant_details, variant_retirements). ApplicationController adds no authentication. Admin::SessionsController and Admins::OmniauthCallbacksController do not inherit from it, so the sign-in pages are reachable without a session.
