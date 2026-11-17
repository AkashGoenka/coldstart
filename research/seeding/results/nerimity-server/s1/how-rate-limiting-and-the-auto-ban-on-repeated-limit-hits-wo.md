---
id: how-rate-limiting-and-the-auto-ban-on-repeated-limit-hits-wo
type: flow
title: "how rate limiting and the auto-ban on repeated limit hits work"
anchors:
  - {"path":"src/worker.ts","hash":"sha256:7aad3db837fe","head":"feb30ff9ac54"}
  - {"path":"src/routes/channels/channelMessageCreate.ts","hash":"sha256:b2a79a697b43","head":"feb30ff9ac54"}
  - {"path":"src/middleware/rateLimit.ts","hash":"sha256:637f3c74f331","head":"feb30ff9ac54"}
  - {"path":"src/cache/RateLimitCache.ts","hash":"sha256:aa9c56fc8676","head":"feb30ff9ac54"}
  - {"path":"src/services/Server.ts","hash":"sha256:792485ceaf54","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:45.481Z
edits: 1
---

# how rate limiting and the auto-ban on repeated limit hits work

The auto-ban is not part of the limiter: `checkAndUpdateRateLimit` only counts how often a window reaches its limit and then calls whatever `onThreeIterations` callback the caller passed, and `channelMessageCreate.ts` is the only caller in src that passes one, so the ban exists only for `create_message`. The window is keyed per user across all channels, but the three-strike counter is keyed per user per channel. The callback is fire-and-forget: it is not awaited, and the `[null, error]` tuple returned by `banServerMember` is discarded.

## Steps

1. `src/worker.ts` (`rateLimit`) — API process only: the app-wide `global_limit` (per IP, 100 requests per 15 s, 30 s block) is mounted after the OpenGraph router and before the /api routers. It is a separate limit and does not feed the message counter.
2. `src/routes/channels/channelMessageCreate.ts` (`channelMessageCreate`, `route`) — Route chain: auth, channel and permission middleware, then body validators (they only collect errors), then rateLimit(create_message) (20 per 20 s), then `route`. `route` runs the slow-mode check and then produces the 400 for validation errors. The onThreeIterations callback bans the sender unless the channel is not SERVER_TEXT or the sender is the server owner.
3. `src/middleware/rateLimit.ts` (`rateLimit`) — Builds the key (user id plus `-create_message`), skips all limiting under DEV_MODE unless the body carries test_enable_rate_limit, wraps the callback so it receives (req, res), and answers 429 with the TTL in ms when blocked.
4. `src/cache/RateLimitCache.ts` (`checkAndUpdateRateLimit`) — Runs the Lua script over the window hash and the three-strike counter. A hit that reaches the limit returns the TTL. The third such hit inside the counter window deletes the counter, returns -2, and calls the callback.
5. `src/services/Server.ts` (`banServerMember`) — The ban the callback performs: refuses the server owner by returning an error tuple, otherwise calls leaveServer with ban: true and logs it. Its shouldDeleteRecentMessages argument is set to true by the callback.

## Invariants

- checkAndUpdateRateLimit returns false when allowed and a positive TTL in ms when blocked, so callers must treat any truthy value as blocked.
- Only the call that flips a window to status REACHED counts toward the three strikes; calls made while the window is REACHED return early and do not increment the counter.
- The three-strike counter key expires 3 minutes after its first count (fixed, not sliding) and is deleted when it fires, so the next strike starts from zero.
- Under DEV_MODE the middleware limiters are skipped unless the request body carries test_enable_rate_limit, so the ban callback cannot fire in dev without that flag.
