---
id: src-cache-usercache-ts-c1dba15e
type: file
character: single
title: "src/cache/UserCache.ts"
anchors:
  - {"path":"src/cache/UserCache.ts","symbols":["authenticateUser","getUserCacheBySessionId","storeUserCache","beforeAuthenticateCache","addAllowedIPCache","removeAllowedIPsCache","removeSessions","removeUserCacheByUserIds","addSocketUser","socketDisconnect","getServerMembersOnline"],"hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.822Z
edits: 2
---

# src/cache/UserCache.ts

Holds the auth hot path and presence. authenticateUser takes the decrypted token's first field as a session id, and getUserCacheBySessionId resolves it with one Lua EVAL over the session key and user key, falling back to userDevice.findFirst and re-setting the session key with EX 3600. Suspension is checked only in storeUserCache via beforeAuthenticateCache (so a cached user is not re-checked; clearing the user cache is what forces it). The IP-ban check (isIpBanned, founders exempt) runs only when the IP is not in the ALLOWED_IP set or differs from the cached ip, and addDeviceWithSession runs before it, so a banned IP still gets a device row. User cache entries and the cached ip have no expiry and storeUserCache builds the entry without ip, so the first request after a rebuild always takes the slow path. addAllowedIPCache re-applies a 3600s expiry to the whole set on each add. Presence: addSocketUser writes the presence key only when the user's socket set was empty and socketDisconnect deletes it only on the last socket; getServerMembersOnline SCANs every presence key. removeSessions deletes only session keys, not the user cache entry.
