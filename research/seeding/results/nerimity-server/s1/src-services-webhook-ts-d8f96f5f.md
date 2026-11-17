---
id: src-services-webhook-ts-d8f96f5f
type: file
character: hub
title: "src/services/Webhook.ts"
anchors:
  - {"path":"src/services/Webhook.ts","symbols":["getWebhookToken","createWebhook","deleteWebhook","updateWebhook"],"hash":"sha256:9624c370df00","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.454Z
edits: 1
---

# src/services/Webhook.ts

## Facets

- **getWebhookToken** — Re-signs the token on every call (`<webhook.id>-1` with JWT_WEBHOOK_SECRET) and stores nothing, so fetching it does not rotate anything. generateToken passes no expiresIn, so the token has no exp claim and stays valid for as long as the row is not deleting.
- **createWebhook** — Allows at most 4 non-deleting webhooks per channel and only SERVER_TEXT channels. The name is `Webhook <liveCount+1>`, so after a delete a new webhook can get a name another live webhook already has.
- **deleteWebhook** — Soft delete: sets deleting=true (the row stays and every other read filters deleting: null) and then removes the Redis entry. Its where clause also requires avatar: null, and unlike updateWebhook this update has no .catch.
- **updateWebhook** — Changes only the name. A missing row comes back as 'Webhook not found.' because the update's error is swallowed by a .catch.
