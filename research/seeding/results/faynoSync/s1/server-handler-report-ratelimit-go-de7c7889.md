---
id: server-handler-report-ratelimit-go-de7c7889
type: file
character: single
title: "server/handler/report/ratelimit.go"
anchors:
  - {"path":"server/handler/report/ratelimit.go","symbols":["checkRateLimits"],"hash":"sha256:3aeadf027869","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.468Z
edits: 1
---

# server/handler/report/ratelimit.go

checkRateLimits runs three fixed-window Redis counters in order: per report key per minute (REPORTS_RATE_LIMIT_PER_KEY_PER_MINUTE, default 100), per device plus group per hour (limit 1, so a second report of the same group from the same device in the same hour gets 429), and per group per minute (limit 30). Each INCR is compared right after it runs, so a 429 from a later window leaves the earlier windows counted for that request. Any Redis error logs and returns allowed, and a nil client also returns allowed. The Expire return value is ignored. Tests TestReportRateLimitPerDevice, TestReportRateLimitPerGroup and TestReportRateLimitPerKey in faynoSync_test.go cover these windows and skip when the test Redis client is nil.
