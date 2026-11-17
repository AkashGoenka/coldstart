---
id: how-a-moderation-endpoint-is-authorized-and-what-a-suspensio
type: flow
title: "how a moderation endpoint is authorized and what a suspension does"
anchors:
  - {"path":"src/routes/moderation/Router.ts","hash":"sha256:49b90c7aa8b6","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/isModMiddleware.ts","hash":"sha256:dfb3a4a12710","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/getUser.ts","hash":"sha256:a2168a57507b","head":"feb30ff9ac54"}
  - {"path":"src/services/Moderation.ts","hash":"sha256:84b473cb43d1","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/getAuditLogs.ts","hash":"sha256:01d41cb1dcd3","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/getUsersAuditLog.ts","hash":"sha256:8988cfb7b5df","head":"feb30ff9ac54"}
  - {"path":"src/routes/moderation/userBatchUnsuspend.ts","hash":"sha256:42c6a1216cc1","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.045Z
edits: 1
---

# how a moderation endpoint is authorized and what a suspension does

Authorization is per route, not per router: ModerationRouter adds no middleware, so each route file declares authenticate() and isModMiddleware(...) itself, and the decision is a single badge-bit test on req.userCache.badges (FOUNDER or ADMIN; MOD only on routes passing allowModBadge). A suspension is later enforced on every authentication by UserCache, and suspendUsersBatch clears the user cache and disconnects sockets so that enforcement runs again.

## Steps

1. `src/routes/moderation/Router.ts` (`ModerationRouter`) — registers route files with no router-level middleware
2. `src/routes/moderation/isModMiddleware.ts` (`isModMiddleware`) — badge gate; sets req.hasAdminOrCreatorBadge
3. `src/routes/moderation/getUser.ts` (`getUser`) — example handler that re-checks req.hasAdminOrCreatorBadge to hide emails and IPs from mods
4. `src/services/Moderation.ts` (`suspendUsersBatch`, `warnUsersBatch`, `disconnectUsers`) — suspension, IP-ban and warning escalation writes
5. `src/cache/UserCache.ts` (`beforeAuthenticateCache`, `authenticateUser`) — enforces suspension on cache rebuild and IP ban on the slow path

## Invariants

- isModMiddleware reads req.userCache, so authenticate() must come first in the route chain.
- Mod routes are split between admin-only (getAuditLogs reads prisma.modAuditLog) and mod-visible (getUsersAuditLog reads server-scoped AuditLog rows); they are different tables.
- Unsuspending does not delete bannedIp rows; there is no endpoint that removes an active IP ban.
