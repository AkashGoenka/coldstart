---
id: how-a-rest-authorization-header-becomes-req-usercache
type: flow
title: "how a REST Authorization header becomes req.userCache"
anchors:
  - {"path":"src/middleware/userIP.ts","hash":"sha256:db58733b560a","head":"feb30ff9ac54"}
  - {"path":"src/middleware/authenticate.ts","hash":"sha256:ddf71e34f0ec","head":"feb30ff9ac54"}
  - {"path":"src/common/JWT.ts","hash":"sha256:5e9702085f2b","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/cache/CacheKeys.ts","hash":"sha256:71c6dc8781da","head":"feb30ff9ac54"}
  - {"path":"src/services/User/User.ts","hash":"sha256:b8459d427552","head":"feb30ff9ac54"}
  - {"path":"src/services/User/UserManagement.ts","hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
  - {"path":"src/services/Application.ts","hash":"sha256:dd60a8004745","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:27.798Z
edits: 1
---

# how a REST Authorization header becomes req.userCache

The Authorization header is the JWT with its constant header segment stripped, and the first field of the decrypted payload is treated as a session id (not a user id). It is resolved through Redis SESSION_USER_ID and USER keys, falling back to the userDevice table, and the IP-ban check only runs when the global ALLOWED_IP set or the cached user's last ip does not match the request. Bot tokens are minted separately by getBotToken and are rejected by authenticate unless the route passes allowBot.

## Steps

1. `src/middleware/userIP.ts` (`userIP`) — Sets req.userIP (cf-connecting-ip, then x-forwarded-for, then socket address) and req.deviceType before authenticate runs; it is app.use-wired only in the api env.
2. `src/middleware/authenticate.ts` (`authenticate`) — Reads the raw Authorization header, answers 401 when it is missing unless allowNoToken, calls authenticateUser, and rejects cachedUser.bot unless allowBot.
3. `src/common/JWT.ts` (`decryptToken`) — Re-adds the fixed header eyJhbGciOiJIUzI1NiJ9. and verifies with JWT_SECRET; splits the payload on '-' into userId (used as the session id) and passwordVersion.
4. `src/cache/UserCache.ts` (`authenticateUser`, `getUserCacheBySessionId`, `storeUserCache`) — authenticateUser resolves the session via Lua (session key, then USER key); on a miss it falls back to userDevice by sessionId and rebuilds the user cache; then it applies the IP gate.
5. `src/cache/CacheKeys.ts` (`SESSION_ID_TO_USER_ID`, `USER_CACHE_KEY_STRING`, `ALLOWED_IP_KEY_SET`) — Key formats: NERIMITY_SESSION_USER_ID:<sessionId>, NERIMITY_USER:<userId>, and the single global NERIMITY_ALLOWED_IP set.
6. `src/services/User/User.ts` (`isIpBanned`) — Returns the active bannedIp row; an expired ban is deleted on read and reported as not banned.
7. `src/services/User/UserManagement.ts` (`addDeviceWithSession`) — Upserts the userDevice row keyed by userId, ipAddress and sessionId; this row is what the DB fallback in step 4 finds.
8. `src/services/Application.ts` (`getBotToken`) — Bot path: reuses the bot user's existing device sessionId or creates one, then returns generateToken(sessionId, 1); this token is what authenticate later accepts only with allowBot.

## Invariants

- Revoking a session means deleting its NERIMITY_SESSION_USER_ID key (removeSessions) and its userDevice rows (removeSessionsByUserId). Clearing only the NERIMITY_USER key does not revoke it: the next request falls back to userDevice and recreates the user cache.
- The suspension check (beforeAuthenticateCache) runs only on a user-cache miss, so a suspended user is rejected on this path only after the NERIMITY_USER key is cleared.
- The IP-ban check is skipped when the IP is in ALLOWED_IP and userCache.ip equals the request IP; the ALLOWED_IP set is global, not per user.
