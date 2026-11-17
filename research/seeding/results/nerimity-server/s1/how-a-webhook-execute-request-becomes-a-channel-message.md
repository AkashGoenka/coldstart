---
id: how-a-webhook-execute-request-becomes-a-channel-message
type: flow
title: "how a webhook execute request becomes a channel message"
anchors:
  - {"path":"src/routes/webhooks/Router.ts","hash":"sha256:0f85f267f7d6","head":"feb30ff9ac54"}
  - {"path":"src/routes/webhooks/webhookExecute.ts","hash":"sha256:a453030c0955","head":"feb30ff9ac54"}
  - {"path":"src/common/webhookAuthenticate.ts","hash":"sha256:a234ddd03d96","head":"feb30ff9ac54"}
  - {"path":"src/common/JWT.ts","hash":"sha256:5e9702085f2b","head":"feb30ff9ac54"}
  - {"path":"src/cache/WebhookCache.ts","hash":"sha256:5dcc911dcfbf","head":"feb30ff9ac54"}
  - {"path":"src/services/Webhook.ts","hash":"sha256:9624c370df00","head":"feb30ff9ac54"}
  - {"path":"src/services/Message/MessageCreate.ts","hash":"sha256:0e43ea106d0b","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.430Z
edits: 1
---

# how a webhook execute request becomes a channel message

The webhook token is a header-less HS256 JWT signed with JWT_WEBHOOK_SECRET, not JWT_SECRET, and it has no exp claim, so a webhook stops authenticating only when its row is filtered out by `deleting: null` on a cache fill or its Redis entry is removed. Username and avatar on the request are not stored on the webhook: they become shared messageCreatorOverride rows keyed by the (username, avatarUrl) pair. Creator overrides are resolved in createMessageAndChannelUpdate, which runs before the side effects are dispatched.

## Steps

1. `src/routes/webhooks/Router.ts` (`WebhooksRouter`) — mounts webhookkExecute and webhookkExecuteGitHub on one router; both POST under /webhooks/:webhookId/:token
2. `src/routes/webhooks/webhookExecute.ts` (`webhookkExecute`, `route`) — express-validator limits, then the content-required and username bad-word checks, all before any token check; then webhookAuthenticate (401), the per-channel rate limit (429), a new URL() check on avatarUrl, and createMessage with username_override and avatar_url_override
3. `src/common/webhookAuthenticate.ts` (`webhookAuthenticate`) — verifies the token with env.JWT_WEBHOOK_SECRET and compares the token's user id with the URL webhookId; the version half of the payload is parsed but not compared; then fetchWebhookCache
4. `src/common/JWT.ts` (`decryptToken`, `generateToken`) — generateToken drops the HS256 header from the token string and decryptToken prepends the fixed header eyJhbGciOiJIUzI1NiJ9. before jwt.verify; any verify failure returns null
5. `src/cache/WebhookCache.ts` (`fetchWebhookCache`, `removeWebhookCache`) — reads the Redis key first; on a miss loads the row through getWebhookForCache and writes it back with a 1800 second expiry
6. `src/services/Webhook.ts` (`getWebhookForCache`) — the database fallback; it filters deleting: null, so a soft-deleted row is not re-cached
7. `src/services/Message/MessageCreate.ts` (`createMessageV2`, `createMessageAndChannelUpdate`) — createMessage is an alias of createMessageV2, which validates, then creates the message inside createMessageAndChannelUpdate (where creator overrides are resolved and webhookId and creatorOverrideId are stored), then calls handleMessageSideEffects without awaiting it

## Invariants

- A webhook token never expires by itself; the only revocations are the deleting flag (applied when the cache entry next misses) and removeWebhookCache.
- Cache entries are not re-checked against the database while they are valid, so a row marked deleting without a cache removal keeps authenticating until its entry expires (1800 seconds).
- The rate-limit key is `<channelId>-wh-exec`, the same key the GitHub webhook route uses, so both routes share one budget of 10 requests per 5 seconds per channel.
