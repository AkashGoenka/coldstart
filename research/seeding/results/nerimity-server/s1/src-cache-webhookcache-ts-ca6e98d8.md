---
id: src-cache-webhookcache-ts-ca6e98d8
type: file
character: single
title: "src/cache/WebhookCache.ts"
anchors:
  - {"path":"src/cache/WebhookCache.ts","symbols":["fetchWebhookCache","removeManyWebhookCache"],"hash":"sha256:5dcc911dcfbf","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.449Z
edits: 1
---

# src/cache/WebhookCache.ts

Redis copy of the webhook row used for token auth: entries are written with a 1800 second expiry and filled from `getWebhookForCache`, which excludes deleting rows. Invalidation is explicit only: `removeWebhookCache` runs in `deleteWebhook`, and `removeManyWebhookCache` runs in Channel and Server deletion, but the user-account deletion path (UserManagement) marks webhooks deleting without clearing their entries. In Channel and Server deletion the cache is cleared before the transaction that sets `deleting`, so a fetch in between re-caches the still-live row for up to 30 minutes.
