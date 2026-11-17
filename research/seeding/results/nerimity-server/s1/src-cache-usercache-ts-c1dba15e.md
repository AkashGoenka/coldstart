---
id: src-cache-usercache-ts-c1dba15e
type: file
character: hub
title: "src/cache/UserCache.ts"
anchors:
  - {"path":"src/cache/UserCache.ts","symbols":["authenticateUser","getUserCacheBySessionId","storeUserCache","addAllowedIPCache","getServerMembersOnline","addSocketUser","socketDisconnect"],"hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:05.479Z
edits: 2
---

# src/cache/UserCache.ts

## Facets

- **authenticateUser** — Suspension (beforeAuthenticateCache) runs only inside storeUserCache, so it is checked only when the user-cache entry is missing; a cached user skips it. The IP-ban lookup and addDeviceWithSession run only when the IP is not in the allowed-IP set or differs from the cached ip, and addDeviceWithSession runs before the ban return, so a banned login still writes a device row. newToken is a const set to null, so the newToken branches in onAuthenticate never receive a value.
- **getUserCacheBySessionId** — Session to user is a Redis key read by a Lua GET. When either the session key or the user-cache entry is missing, it falls back to prisma.userDevice.findFirst by sessionId, writes the session key with a 1-hour TTL, and builds the cache. A cache hit does not refresh that TTL.
- **storeUserCache** — The user cache is written with SET and no expiry, so the only invalidation is explicit removeUserCacheByUserIds. beforeAuthenticateCache (the suspension check via getSuspensionDetails) runs only on this miss path, so a warm cache skips it.
- **addAllowedIPCache** — ALLOWED_IP is one global set that every add refreshes with EXPIRE 3600. removeAllowedIPsCache is called from src/services/Moderation.ts and src/routes/moderation/userEditSuspension.ts.
- **getServerMembersOnline** — The partial path SCANs every USER_PRESENCE key in Redis, not only this user's servers, keeps the online user ids, and then queries serverMember rows for those users restricted to the background server ids. The requesting user's own memberships and the currentServerId members are fetched first, separately.
- **addSocketUser** — Presence is written only when the user's socket-id set was empty (sCard 0). The return value (true for the first socket) gates the presence broadcast in onAuthenticate. socketDisconnect deletes the presence key only when it removes the last socket.
