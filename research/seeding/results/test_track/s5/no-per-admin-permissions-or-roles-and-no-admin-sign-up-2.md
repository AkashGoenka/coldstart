---
id: no-per-admin-permissions-or-roles-and-no-admin-sign-up-2
type: lesson
kind: absence
title: "no per-admin permissions or roles and no admin sign-up"
scope: {"terms":["pundit","cancan","role","permission","authorize","admin"]}
status: active
updated: 2026-11-16T18:22:53.422Z
edits: 1
---

# no per-admin permissions or roles and no admin sign-up

Searched app/, config/routes.rb and the Admin model for roles, authorization libraries (pundit/cancan) and registration routes. None exist: any signed-in Admin can change any split, weights, decisions and bulk assignments for every app (Admin::* controllers only run authenticate_admin!). Admin records are created out of band (console in database mode, auto-created on first SAML login).

## Scope (absence — freshness = re-run this search)

- terms: `pundit`, `cancan`, `role`, `permission`, `authorize`, `admin`
