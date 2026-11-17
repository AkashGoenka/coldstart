---
id: how-a-request-gets-rate-limited
type: flow
title: "how a request gets rate limited"
anchors:
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/middleware/rateLimit.ts","hash":"sha256:637f3c74f331","head":"feb30ff9ac54"}
  - {"path":"src/cache/RateLimitCache.ts","hash":"sha256:aa9c56fc8676","head":"feb30ff9ac54"}
  - {"path":"src/cache/CacheKeys.ts","hash":"sha256:71c6dc8781da","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/routes/users/register.ts","hash":"sha256:81ed7e4335e8","head":"feb30ff9ac54"}
  - {"path":"src/routes/webhooks/webhookExecute.ts","hash":"sha256:a453030c0955","head":"feb30ff9ac54"}
  - {"path":"src/socket/events/onChangeActivity.ts","hash":"sha256:5e45c1e5f515","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:05.028Z
edits: 1
---

# how a request gets rate limited

Every counter lives in Redis and each decision is one Lua script in RateLimitCache.ts; the middleware only maps a request to a key id and limits. The global_limit (per IP, 100 requests per 15s, 30s block) is mounted in worker.ts after the OpenGraph router, so /api/og routes are not counted; per-route limiters sit after auth and permission middleware but before the handler reads its validation errors, so rejected bodies still spend quota. In DEV_MODE the middleware passes everything through unless the JSON body sets test_enable_rate_limit.

## Steps

1. `src/worker.ts` (`app`) — mounts the global_limit rateLimit inside the api branch
2. `src/middleware/rateLimit.ts` (`rateLimit`) — DEV_MODE bypass, key id build (user id or IP, plus name; globalLimit uses the bare name), 429 mapping
3. `src/cache/RateLimitCache.ts` (`checkAndUpdateRateLimit`) — Lua counter with fixed window, blocked state, and 3-episode onThreeIterations trigger
4. `src/routes/channels/channelMessageCreate.ts` (`channelMessageCreate`, `route`) — example: create_message limiter plus a separate in-handler slow-mode limiter
5. `src/routes/users/register.ts` (`route`) — globalLimit example: one shared bucket for all clients

## Invariants

- The window is fixed from the first request (PEXPIRE set on creation, HINCRBY does not refresh it), not sliding.
- An API primary start deletes NERIMITY_RATE_LIMIT* keys (they are not WS_KEYS), so limit state does not survive an api restart.
- Webhook execution (rateLimitCheck) and socket activity updates call checkAndUpdateRateLimit directly with their own keys and do not go through the middleware or its DEV_MODE bypass.
