---
id: no-live-message-queue-on-the-create-route-and-no-silent-hand
type: lesson
kind: absence
title: "no live message queue on the create route and no silent handling outside push"
scope: {"terms":["createQueue","mimiqueue","queueRoute","silent"]}
status: active
updated: 2026-11-17T03:29:05.236Z
edits: 1
---

# no live message queue on the create route and no silent handling outside push

channelMessageCreate.ts imports createQueue from @nerimity/mimiqueue but the queue call is commented out, so queueRoute calls route() directly. The silent flag is read only in fcm/pushNotification.ts; addMention and the socket emits never read it.

## Scope (absence — freshness = re-run this search)

- terms: `createQueue`, `mimiqueue`, `queueRoute`, `silent`
