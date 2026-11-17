---
id: server-utils-utils-go-5245440f
type: file
character: hub
title: "server/utils/utils.go"
anchors:
  - {"path":"server/utils/utils.go","symbols":["ParseUploadData","CountUrls","ExtractChangelog","ExtractS3Key"],"hash":"sha256:109599a3946c","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T16:11:16.776Z
edits: 1
---

# server/utils/utils.go

## Facets

- **ParseUploadData** — Version dashes become dots on upload (ParseUploadData) and on get/delete query params (extractParamsFromGetOrDelete), so both paths use the same normalized form.
- **CountUrls** — singleUrl is the last matching url visited while ranging over Go maps, which is randomized, so its value varies between runs when the count is greater than one. The caller in info/latest.go:502 reads both returns.
- **ExtractChangelog** — Indexes results[0] with no length check, and nothing in the repo calls it (grep finds only the definition).
- **ExtractS3Key** — Private links: the API_URL + /download?key= prefix is trimmed with TrimPrefix, with no check that it matched. Public links go through parsePublicURL, whose generic fallback never errors and uses the link with the endpoint prefix trimmed as the key. Both paths then run url.QueryUnescape, which decodes + as a space.
