---
id: how-an-authorization-token-becomes-a-cached-user-and-what-lo
type: flow
title: "how an Authorization token becomes a cached user (and what login does not check)"
anchors:
  - {"path":"src/routes/users/login.ts","hash":"sha256:7005a5cefde0","head":"feb30ff9ac54"}
  - {"path":"src/services/UserAuthentication.ts","hash":"sha256:540cbfe6b16b","head":"feb30ff9ac54"}
  - {"path":"src/common/JWT.ts","hash":"sha256:5e9702085f2b","head":"feb30ff9ac54"}
  - {"path":"src/middleware/authenticate.ts","hash":"sha256:ddf71e34f0ec","head":"feb30ff9ac54"}
  - {"path":"src/cache/UserCache.ts","hash":"sha256:878af0f3f93c","head":"feb30ff9ac54"}
  - {"path":"src/services/User/User.ts","hash":"sha256:b8459d427552","head":"feb30ff9ac54"}
  - {"path":"src/services/User/UserManagement.ts","hash":"sha256:59ef24208b62","head":"feb30ff9ac54"}
  - {"path":"src/middleware/oAuth2Authenticate.ts","hash":"sha256:b58635db5e81","head":"feb30ff9ac54"}
  - {"path":"src/common/webhookAuthenticate.ts","hash":"sha256:a234ddd03d96","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onAuthenticate.ts","hash":"sha256:482a084856c5","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.020Z
edits: 1
---

# how an Authorization token becomes a cached user (and what login does not check)

The Authorization header is the raw session token with no Bearer prefix; authenticateUser decrypts it, treats the first payload field as a session id, and resolves it through a Redis session key falling back to the userDevice table, while suspension and IP-ban checks run only on specific paths, never at login. Suspension is checked only when a user cache entry is (re)built, so enforcement relies on clearing the user cache; IP bans are checked only when the request IP is not in the ALLOWED_IP set or differs from the cached ip. Bots are rejected in the route middleware after authenticateUser has already run its side effects. OAuth2 and webhooks have their own authenticators that skip the user cache and these checks.

## Steps

1. `src/routes/users/login.ts` (`route`) — login route: rate limit then three login paths (googleCode, email, username:tag); no suspension or IP-ban check
2. `src/services/UserAuthentication.ts` (`loginUser`, `registerUser`) — verifies credentials, creates the session/device and signs the token
3. `src/common/JWT.ts` (`generateToken`, `decryptToken`) — HS256 token with the header segment stripped; payload is '<sessionId>-<passwordVersion>'
4. `src/middleware/authenticate.ts` (`authenticate`) — reads the header, calls authenticateUser, then rejects bots unless allowBot
5. `src/cache/UserCache.ts` (`authenticateUser`, `getUserCacheBySessionId`, `storeUserCache`, `beforeAuthenticateCache`) — session key to user cache via Lua, userDevice fallback, suspension hook on rebuild, IP-ban check on the slow path
6. `src/services/User/User.ts` (`getSuspensionDetails`, `isIpBanned`) — DB reads that delete the row when it has expired
7. `src/services/User/UserManagement.ts` (`addDeviceWithSession`, `removeSessionsByUserId`, `logout`) — device row upsert and session revocation

## Invariants

- A session token is valid only while its sessionId has a userDevice row or a live Redis session key; logout and removeSessionsByUserId delete both.
- passwordVersion is decoded but not compared anywhere in src, so revocation depends on deleting sessions, not on the version.
- Anything that suspends or IP-bans a user must clear the user cache (removeUserCacheByUserIds) or removeAllowedIPsCache, otherwise the checks do not run again for a cached user.
- Socket auth reuses authenticateUser but has no bot check.
