---
id: no-file-bytes-upload-endpoint-in-this-repo
type: lesson
kind: absence
title: "no file-bytes upload endpoint in this repo"
scope: {"terms":["verify-file","generate-token","multer","multipart","formidable","connectBusboyWrapper"]}
status: active
updated: 2026-11-17T03:25:17.364Z
edits: 1
---

# no file-bytes upload endpoint in this repo

Searched the whole repo (excluding node_modules) for verify-file, generate-token, multer, multipart and formidable. The only hits are the two client calls in src/common/nerimityCDN.ts (verifyUpload and generateToken), the connectBusboyWrapper middleware that nothing imports, and formidable inside package-lock.json. So no route here accepts an attachment's bytes; uploads go to the CDN behind LOCAL_NERIMITY_CDN.

## Scope (absence — freshness = re-run this search)

- terms: `verify-file`, `generate-token`, `multer`, `multipart`, `formidable`, `connectBusboyWrapper`
