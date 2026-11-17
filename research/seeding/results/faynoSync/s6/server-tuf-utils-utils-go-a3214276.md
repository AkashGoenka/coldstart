---
id: server-tuf-utils-utils-go-a3214276
type: file
character: single
title: "server/tuf/utils/utils.go"
anchors:
  - {"path":"server/tuf/utils/utils.go","symbols":["ValidateAppName","ValidateExpiration","GetExpirationFromRedis"],"hash":"sha256:1c8dce2a422f","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:57.514Z
edits: 2
---

# server/tuf/utils/utils.go

ValidateAppName allows only [A-Za-z0-9-] because underscore is the Redis key separator and would let different admin/app pairs collide. Expiry maxima (root 365, targets 180, snapshot 30, timestamp 7, delegated 180) are checked only on bootstrap payloads and PUT /tuf/v1/config; defaults used on the bump and add paths are not checked. GetExpirationFromRedis returns the default on any read or parse error.
