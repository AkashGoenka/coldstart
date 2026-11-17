---
id: src-common-errorhandler-ts-ad7b7797
type: file
character: single
title: "src/common/errorHandler.ts"
anchors:
  - {"path":"src/common/errorHandler.ts","symbols":["generateError","customExpressValidatorResult"],"hash":"sha256:58255cd17bd0","head":"feb30ff9ac54"}
status: active
updated: 2026-11-17T03:29:08.961Z
edits: 2
---

# src/common/errorHandler.ts

Despite the name it is not Express error middleware and nothing here is registered with app.use. generateError builds the {message, path (default null), code only when given} body used by route errors. customExpressValidatorResult returns the first error only (for grouped alternatives the first nested error) and null when clean, so the caller must check and respond.
