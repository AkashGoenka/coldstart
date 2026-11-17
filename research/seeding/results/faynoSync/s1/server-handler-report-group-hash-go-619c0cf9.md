---
id: server-handler-report-group-hash-go-619c0cf9
type: file
character: single
title: "server/handler/report/group_hash.go"
anchors:
  - {"path":"server/handler/report/group_hash.go","symbols":["buildGroupHash"],"hash":"sha256:0dae21edafd3","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:35.472Z
edits: 1
---

# server/handler/report/group_hash.go

buildGroupHash is SHA-256 over name|version|channel|platform|arch|type|reason, with the joined fields taken from the validated request. Version and channel are part of the identity, so the same failure on two app versions produces two groups. The separator is what keeps field boundaries apart: group_hash_test.go asserts that name 'ab' with version '1' and name 'a' with version 'b1' hash differently.
