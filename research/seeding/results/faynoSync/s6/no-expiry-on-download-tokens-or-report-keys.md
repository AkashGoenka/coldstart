---
id: no-expiry-on-download-tokens-or-report-keys
type: lesson
kind: absence
title: "no expiry on download tokens or report keys"
scope: {"terms":["expire","ttl","download token","report key"]}
status: active
updated: 2026-11-17T03:28:54.563Z
edits: 1
---

# no expiry on download tokens or report keys

Download tokens (fnd_) and report keys (rpk_) have no expiry field or TTL index; they stop working only on regeneration or deletion of the app/channel (or turning reports off). Report keys are stored raw (key_value), download tokens only as a hash.

## Scope (absence — freshness = re-run this search)

- terms: `expire`, `ttl`, `download token`, `report key`
