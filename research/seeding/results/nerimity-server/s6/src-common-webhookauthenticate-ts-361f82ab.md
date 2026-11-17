---
id: src-common-webhookauthenticate-ts-361f82ab
type: file
character: single
title: "src/common/webhookAuthenticate.ts"
anchors:
  - {"path":"src/common/webhookAuthenticate.ts","symbols":["webhookAuthenticate"],"hash":"sha256:a234ddd03d96","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.836Z
edits: 2
---

# src/common/webhookAuthenticate.ts

Webhook tokens are verified with JWT_WEBHOOK_SECRET and the decoded id must equal the webhook id in the URL; the webhook is then loaded via fetchWebhookCache. No token is stored: getWebhookToken regenerates a deterministic token with no expiry, so it stays valid while the webhook can be found. Both execute routes map a false result to 401 'Invalid webhook token.'.
