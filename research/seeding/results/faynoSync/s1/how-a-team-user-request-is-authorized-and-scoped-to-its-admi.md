---
id: how-a-team-user-request-is-authorized-and-scoped-to-its-admi
type: flow
title: "how a team user request is authorized and scoped to its admin's owner"
anchors:
  - {"path":"server/utils/auth.go","hash":"sha256:4c92a7210edb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/session.go","hash":"sha256:0936ae7a463f","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/utils/owner.go","hash":"sha256:8e7a20e92af2","head":"ca2f88a4fe38"}
  - {"path":"server/utils/token_scope.go","hash":"sha256:3eea7c740688","head":"ca2f88a4fe38"}
  - {"path":"mongod/list.go","hash":"sha256:024eb33d8c29","head":"ca2f88a4fe38"}
  - {"path":"mongod/create.go","hash":"sha256:317006604766","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:17.116Z
edits: 1
---

# how a team user request is authorized and scoped to its admin's owner

Team-user authorization is re-read from the team_users document on each request rather than trusted from the JWT: AuthMiddleware re-verifies the session, CheckPermission reads the route's boolean flag from that same document, and the owner used for queries on the team-user paths is teamUser.Owner, not a name from the request. The route gate does not enforce the per-resource allowed lists; handlers call an EnsureTeamUser*Access check or go through listItems for those. Routes declared before router.Use(authMiddleware) in server/server.go never reach any of this.

## Steps

1. `server/utils/auth.go` (`AuthMiddleware`) — parses the Bearer value as a session JWT and verifies it; an fns_ token that fails JWT parsing takes the API-token branch instead, which yields an admin principal named after the token owner, with is_api_token and allowed_apps set
2. `server/utils/session.go` (`VerifySessionPrincipal`, `CallerTeamUser`) — loads the principal by the token subject _id from team_users or admins; a missing document or a token_version/username mismatch gives errSessionRevoked; CallerTeamUser returns the team document, or nil for an admin
3. `server/utils/permissions.go` (`CheckPermission`) — route gate: admins pass; a team user needs the boolean flag for the (resource, permission) pair; non-empty allowed lists are copied into gin context keys for handlers
4. `server/utils/owner.go` (`ResolveRequestOwner`, `EnsureTeamUserAppAccess`, `EnsureTeamUserUploadAccess`) — ResolveRequestOwner maps a team user to teamUser.Owner; the Ensure checks look up apps_meta rows by owner = teamUser.Owner and compare the row _id hex with the team user's allowed list
5. `server/utils/token_scope.go` (`ValidateAPITokenAppScope`) — for fns_ tokens only, checks the app's apps_meta _id is in the token's allowed_apps; it does not check the permission type
6. `mongod/list.go` (`listItems`) — the only gate on the list routes /app/list, /channel/list, /platform/list and /arch/list; a team user with an empty allowed list for that resource gets an empty result, otherwise _id $in the allowed list and owner = teamUser.Owner
7. `mongod/create.go` (`createMetaDocument`, `updateTeamUserPermissions`) — when a team user creates a resource, the owner is replaced by teamUser.Owner and, after the insert, the new id is added with $addToSet to that team user's one allowed list

## Invariants

- The team user's permission flags and allowed lists are read per request by CheckPermission and the Ensure checks, so an admin revocation applies from the next request on those paths
- The create-path grant writes one allowed list with $addToSet and no whole-permissions object, so a revocation landing after the team user snapshot survives (mongod/team_permissions_race_test.go, which skips unless MONGODB_URL_TESTS is set)
- A deleted team user whose name is reused by another tenant gets 401 on the old token (server/utils/session_test.go, TestSession_DeletedTeamUserRecreatedByOtherTenant), because sessions bind to the document _id
