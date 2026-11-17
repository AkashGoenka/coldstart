---
id: no-per-admin-permissions-or-roles-and-no-admin-sign-up
type: lesson
kind: absence
title: "no per-admin permissions or roles and no admin sign-up"
scope: {"terms":["pundit","cancan","role","permission","authorize","admin"]}
status: retracted
updated: 2026-11-16T18:23:04.062Z
edits: 2
---

# no per-admin permissions or roles and no admin sign-up

> Retracted — kept for history; do not rely on this note.

Searched app/, config/routes.rb and the Admin model for roles, authorization libraries (pundit/cancan) and registrations routes. None exist: any signed-in Admin can change any split, weights, decisions and bulk assignments for every app (Admin::* controllers only run authenticate_admin!). Admin records are created out of band (console, or SAML email pre-provisioning).

## Scope (absence — freshness = re-run this search)

- terms: `pundit`, `cancan`, `role`, `permission`, `authorize`, `admin`
