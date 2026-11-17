---
id: how-to-add-a-new-api-endpoint
type: flow
title: "how to add a new API endpoint"
anchors:
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"server/utils/permissions.go","hash":"sha256:61a5d048145d","head":"ca2f88a4fe38"}
  - {"path":"server/handler/handler.go","hash":"sha256:325af68722ea","head":"ca2f88a4fe38"}
  - {"path":"server/handler/create/create.go","hash":"sha256:116ddb1fa2a8","head":"ca2f88a4fe38"}
  - {"path":"mongod/structs.go","hash":"sha256:5cfee343b008","head":"ca2f88a4fe38"}
  - {"path":"mongod/create.go","hash":"sha256:317006604766","head":"ca2f88a4fe38"}
  - {"path":"server/handler/team/create.go","hash":"sha256:28399b94684f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.350Z
edits: 1
---

# how to add a new API endpoint

The AppRepository interface lives in mongod/structs.go (not adapter.go), the route and its permission live only in server/server.go as inline middleware arguments, and the handler wrapper in handler.go must be added to both the AppHandler interface and the appHandler struct. Touch points: package func under server/handler/<area>, method on appHandler, route with CheckPermission(Permission*, Resource*, mongoDatabase) or AdminOnlyMiddleware, then a repository method in the interface plus its implementation file in mongod/. A new ResourceType also needs a case in CheckPermission's switch or team users are denied while admins pass.

## Steps

1. `server/server.go` (`StartServer`) — register the route in the right side of router.Use(authMiddleware) and attach the permission middleware inline; TUF routes are separate in server/tuf/tuf.go
2. `server/utils/permissions.go` (`CheckPermission`) — switch over resource then permission with no default case: unlisted pairs are denied for team users
3. `server/handler/handler.go` (`AppHandler`, `appHandler`) — interface + method; call reloadTelemetryAllowListAfterSuccess in mutating methods
4. `server/handler/create/create.go` (`CreateItem`) — example create path: dispatches on itemType, does not re-check permissions
5. `mongod/structs.go` (`AppRepository`) — add the method to the interface
6. `mongod/create.go` (`createMetaDocument`, `CreateDocument`, `updateTeamUserPermissions`) — implementation; a team creator's new id is $addToSet'ed into their permissions.<type>.allowed (failure logged, create still succeeds)

## Invariants

- Team-user management (server/handler/team/create.go) writes via *mongo.Database, not AppRepository
- A mutating wrapper that omits the telemetry reload leaves the allow-list stale
