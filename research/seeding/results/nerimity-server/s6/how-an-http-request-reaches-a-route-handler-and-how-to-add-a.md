---
id: how-an-http-request-reaches-a-route-handler-and-how-to-add-a
type: flow
title: "how an http request reaches a route handler and how to add an endpoint"
anchors:
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/middleware/userIP.ts","hash":"sha256:db58733b560a","head":"feb30ff9ac54"}
  - {"path":"src/routes/servers/Router.ts","hash":"sha256:dab164f20e90","head":"feb30ff9ac54"}
  - {"path":"src/routes/servers/serverRoleCreate.ts","hash":"sha256:4934ce27759e","head":"feb30ff9ac54"}
  - {"path":"src/services/ServerRole.ts","hash":"sha256:4409d191c09f","head":"feb30ff9ac54"}
  - {"path":"src/common/errorHandler.ts","hash":"sha256:58255cd17bd0","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/Router.ts","hash":"sha256:49b90c7aa8b6","head":"feb30ff9ac54"}
  - {"path":"src/routes/open-graph/Router.ts","hash":"sha256:9f2d8f23c10f","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.016Z
edits: 1
---

# how an http request reaches a route handler and how to add an endpoint

Routes are wired imperatively and nothing is discovered by file name: a route file exports function(Router) that registers its own path and middleware chain, and it is live only if the area's Router.ts imports it and calls it as fn(Router); the area routers are then mounted at /api in worker.ts in a fixed order, only on the api process. Global order in worker.ts is helmet, cors, express.json/urlencoded (20MB), userIP, OpenGraphRouter, the global_limit rateLimit, /api/status, then the 16 routers (Moderation, Users, Servers, Channels, Friends, Explore, Posts, Connections, Tickets, Emojis, Tenor, Applications, Reminders, Webhooks, Oauth2, Cdn). Handlers return [result, error] tuples from services and answer errors as 400 with generateError bodies; there is no express error middleware.

## Steps

1. `src/worker.ts` (`app`) — global middleware and router mount order, gated on env.TYPE === 'api'
2. `src/middleware/userIP.ts` (`userIP`) — sets req.userIP and req.deviceType for every later limiter and auth call
3. `src/routes/servers/Router.ts` (`ServersRouter`) — example area router: import each route module and call it with the router
4. `src/routes/servers/serverRoleCreate.ts` (`serverRoleCreate`, `route`) — example chain: authenticate, serverMemberVerification, memberHasRolePermissionMiddleware, then route calling the service
5. `src/services/ServerRole.ts` (`createServerRole`) — service: performs no permission check, transactional write, clears member caches, emits, audit log
6. `src/common/errorHandler.ts` (`generateError`, `customExpressValidatorResult`) — error body builder and the helper handlers call to read express-validator results

## Invariants

- Permission and membership are enforced only by the middleware chain declared in each route file; services such as createServerRole do not re-check.
- serverMemberVerification must precede memberHasRolePermissionMiddleware in a chain, because the latter returns allowed when req.serverCache is unset.
- express-validator body() chains only collect errors; the handler must call customExpressValidatorResult(req) itself, which returns null when clean.
- Mount order in worker.ts decides which router sees an overlapping path first; within a router, registration order in Router.ts does.
