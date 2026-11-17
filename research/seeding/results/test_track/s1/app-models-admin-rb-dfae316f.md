---
id: app-models-admin-rb-dfae316f
type: file
character: single
title: "app/models/admin.rb"
anchors:
  - {"path":"app/models/admin.rb","symbols":["from_saml","lookup_admin","devise_args"],"hash":"sha256:0f69ca7bcafa","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:20.978Z
edits: 1
---

# app/models/admin.rb

Admin.from_saml never reports 'unknown admin': it runs find_or_initialize_by(email:) and then update!, which saves a new row on the first SAML sign-in (spec/models/admin_spec.rb 'creates a user if one does not exist'). Each login overwrites full_name from the IdP's info.name and sets provider to 'SAML'; the email is the SAML uid downcased, and uid itself is never written. The admin&.update! guard is dead because find_or_initialize_by never returns nil, and update! has no rescue, so a failed save raises out of the callback. devise_args is evaluated at class load and selects omniauthable (saml) or database_authenticatable from the same SAML_ISSUER check, with trackable, lockable and timeoutable always added.
