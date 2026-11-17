---
id: server-utils-download-access-go-70643761
type: file
character: hub
title: "server/utils/download_access.go"
anchors:
  - {"path":"server/utils/download_access.go","symbols":["DefaultDownloadMode","ValidatePrivateCdnEdge","ValidateDownloadMode","PrivateObjectKey"],"hash":"sha256:21aaaacd96ac","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.636Z
edits: 1
---

# server/utils/download_access.go

## Facets

- **DefaultDownloadMode** — Reads ENABLE_PRIVATE_APP_DOWNLOADING: true gives unlisted, otherwise strict. Used at create for private apps that send no download_mode (server/handler/create/create.go) and by the migration backfill (mongod/migration.go). It is not consulted at request time.
- **ValidatePrivateCdnEdge** — Rejects cdn_edge for private apps with ErrPrivateCdnEdge. Create checks it on every request (create.go); update checks it only when a cdn parameter is sent (server/handler/update/update.go), against the stored app's private flag.
- **ValidateDownloadMode** — Accepts only 'unlisted' or 'strict'. Update rejects a download_mode for a public app (update.go), so the mode exists only on private apps.
- **PrivateObjectKey** — Extracts the storage key from a link containing '/download?key='. It ignores the host, so links keep resolving after API_URL changes. Used when writing s3_key (mongod/create.go, mongod/update.go) and in the backfill (mongod/private_download_backfill.go).
