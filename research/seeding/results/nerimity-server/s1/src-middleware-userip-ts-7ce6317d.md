---
id: src-middleware-userip-ts-7ce6317d
type: file
character: single
title: "src/middleware/userIP.ts"
anchors:
  - {"path":"src/middleware/userIP.ts","symbols":["userIP"],"hash":"sha256:db58733b560a","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:24:27.812Z
edits: 1
---

# src/middleware/userIP.ts

userIP stores the first available of cf-connecting-ip, x-forwarded-for or the socket address as a raw string, without splitting a comma-separated x-forwarded-for list. It also derives req.deviceType from the User-Agent (mobile, electron or browser). authenticateUser uses this value for the IP-ban gate, so the gate sees whatever this stores.
