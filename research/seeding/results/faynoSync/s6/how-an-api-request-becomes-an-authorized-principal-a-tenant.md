---
id: how-an-api-request-becomes-an-authorized-principal-a-tenant
type: flow
title: "how an API request becomes an authorized principal, a tenant owner and an app-scoped action"
anchors:
  - {"path":"server/utils/auth.go","hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/session.go","hash":"sha256:0936ae7a463f","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/utils/owner.go","hash":"sha256:8e7a20e92af2","head":"ca2f88a4fe38"}
  - {"path":"server/utils/token_scope.go","hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
  - {"path":"mongod/list.go","hash":"sha256:024eb33d8c29","head":"ca2f88a4fe38"}
  - {"path":"server/handler/sign/login.go","hash":"sha256:d0889ca7a8c5","head":"ca2f88a4fe38"}
  - {"path":"server/handler/token/create.go","hash":"sha256:6254f308d46e","head":"ca2f88a4fe38"}
  - {"path":"mongod/check.go","hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
  - {"path":"server/utils/utils.go","hash":"sha256:109599a3946c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.347Z
edits: 1
---

# how an API request becomes an authorized principal, a tenant owner and an app-scoped action

Authentication, tenant resolution and authorization are three separate steps: global AuthMiddleware sets the principal, handlers call ResolveRequestOwner to get the tenant (GetUsernameFromContext returns the team user's own name, not the tenant), and CheckPermission only checks one action bit. Team allow-lists (apps/channels/platforms/archs) are NOT checked by CheckPermission; they are enforced at call sites (Ensure* in owner.go, listItems/GetAppByName in the repository).

## Steps

1. `server/utils/auth.go` (`AuthMiddleware`) — session JWT first, else fns_ API token (sha256 lookup in api_tokens, becomes an admin-type principal with is_api_token and allowed_apps)
2. `server/utils/session.go` (`VerifySessionPrincipal`, `CallerTeamUser`) — re-checks the JWT against admins/team_users by _id, token_version and username on every request; permissions are read live, not from the token
3. `server/utils/permissions.go` (`CheckPermission`, `AdminOnlyMiddleware`) — fns_ tokens pass only (PermissionUpload, ResourceApps) with non-empty allowed_apps; admins bypass; team users get one action bit read from their document
4. `server/utils/owner.go` (`ResolveRequestOwner`, `EnsureTeamUserAppAccess`, `EnsureTeamUserUploadAccess`) — team user -> teamUser.Owner, then allow-list checks
5. `server/utils/token_scope.go` (`ValidateAPITokenAppScope`) — fns_ requests only: app must be in the token's allowed_apps
6. `mongod/list.go` (`listItems`) — team callers filtered by allowed IDs; fns_ callers filtered by owner only

## Invariants

- A team principal is authorized by _id and token_version, never by username
- An fns_ caller is an admin-type principal, so team allow-lists do not apply to it
- Changing a team user's password or an admin's password revokes sessions; changing team permissions does not (session tests)
