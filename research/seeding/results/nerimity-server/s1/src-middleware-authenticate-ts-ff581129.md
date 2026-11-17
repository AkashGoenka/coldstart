---
id: src-middleware-authenticate-ts-ff581129
type: file
character: single
title: "src/middleware/authenticate.ts"
anchors:
  - {"path":"src/middleware/authenticate.ts","symbols":["authenticate"],"hash":"sha256:ddf71e34f0ec","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:27.805Z
edits: 1
---

# src/middleware/authenticate.ts

authenticate(opts) passes the raw Authorization header straight to authenticateUser, with no Bearer prefix handling. A missing header gives 401 unless allowNoToken is set, and a bot user gets 401 unless the route passes allowBot. Only error.message from authenticateUser is returned to the client, so the ip-ban data object (type, expire) is dropped on REST.
