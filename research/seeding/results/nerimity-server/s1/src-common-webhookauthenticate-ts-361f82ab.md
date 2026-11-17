---
id: src-common-webhookauthenticate-ts-361f82ab
type: file
character: single
title: "src/common/webhookAuthenticate.ts"
anchors:
  - {"path":"src/common/webhookAuthenticate.ts","symbols":["webhookAuthenticate"],"hash":"sha256:a234ddd03d96","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:25:42.443Z
edits: 1
---

# src/common/webhookAuthenticate.ts

Token check shared by the execute and GitHub webhook routes. The token is verified with `JWT_WEBHOOK_SECRET`, not the user `JWT_SECRET`, and only its user-id half is compared with the URL `webhookId`; the version half is parsed but never checked. A valid token is then resolved through `fetchWebhookCache`, so a webhook's `deleting` flag takes effect only after its Redis entry is gone.
