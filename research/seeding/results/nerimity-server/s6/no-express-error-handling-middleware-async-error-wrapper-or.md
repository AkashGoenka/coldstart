---
id: no-express-error-handling-middleware-async-error-wrapper-or
type: lesson
kind: absence
title: "no express error-handling middleware, async-error wrapper or trust proxy setting"
scope: {"terms":["ErrorRequestHandler","express-async-errors","unhandledRejection","trust proxy"]}
status: active
updated: 2026-11-17T03:29:05.218Z
edits: 1
---

# no express error-handling middleware, async-error wrapper or trust proxy setting

worker.ts registers no four-argument error handler; package.json has no express-async-errors; nothing in src references unhandledRejection or uncaughtException; 'trust proxy' is not set (client IP comes straight from cf-connecting-ip / x-forwarded-for in userIP.ts).

## Scope (absence — freshness = re-run this search)

- terms: `ErrorRequestHandler`, `express-async-errors`, `unhandledRejection`, `trust proxy`
