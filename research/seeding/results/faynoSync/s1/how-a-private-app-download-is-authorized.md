---
id: how-a-private-app-download-is-authorized
type: flow
title: "how a private app download is authorized"
anchors:
  - {"path":"server/handler/download/download.go","hash":"sha256:2c120c73a9df","head":"ca2f88a4fe38"}
  - {"path":"mongod/download_tokens.go","hash":"sha256:90e85b3c5f12","head":"ca2f88a4fe38"}
  - {"path":"server/utils/download_access.go","hash":"sha256:21aaaacd96ac","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/access.go","hash":"sha256:d6c6e35a64cc","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/velopack_feed.go","hash":"sha256:dad67a75a6a8","head":"ca2f88a4fe38"}
  - {"path":"mongod/app_access.go","hash":"sha256:1843976c2805","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:26:03.606Z
edits: 1
---

# how a private app download is authorized

A /download key is resolved first, then gated by the artifact's app download_mode, and every denial returns the same 404 body as an unknown key, so the order of the checks decides the result: valid session, then unlisted mode, then X-Download-Token. The same decision is reused by version reads (checkVersion, latest, velopack feed), so a private app is gated the same way on both paths. Only a session-authorized download gets JSON; every other success is a 302 redirect to a 15-minute presigned URL.

## Steps

1. `server/handler/download/download.go` (`DownloadArtifact`) — reads ?key, maps not-found to 404, runs the gate, then presigns the object and redirects (or returns JSON for session callers)
2. `mongod/download_tokens.go` (`FindPrivateArtifact`) — resolves the key through artifacts.s3_key and keeps only apps whose apps_meta.private is true; a key on a public app is not found
3. `server/handler/download/download.go` (`authorizeDownload`) — order: a bearer session that CanDownloadPrivateArtifact accepts wins; then mode unlisted allows anyone; then the X-Download-Token header is checked; otherwise denied
4. `mongod/download_tokens.go` (`CanDownloadPrivateArtifact`) — session user must be the artifact owner, or a team user with apps download permission and app/channel allowlist access
5. `mongod/download_tokens.go` (`HasDownloadToken`) — matches the SHA token hash together with app_id, channel_id and owner, so a token only opens its own channel
6. `server/utils/download_access.go` (`DownloadModeUnlisted`) — the only mode value that opens anonymous access; any other stored value takes the strict path
7. `server/handler/info/access.go` (`authorizeRead`) — version-read reuse of the same credential order, with the artifact rebuilt from ResolveAppAccess
8. `mongod/app_access.go` (`ResolveAppAccess`) — reads private, download_mode, cdn_edge and the channel id from apps_meta before any version data is built
9. `server/handler/info/velopack_feed.go` (`FindVelopackFeed`, `authorizeVelopackRead`) — feed requests go through the same gate; a denied feed returns 200 with empty Assets, a denied .nupkg returns 404

## Invariants

- A denied download and a missing key return the same body (respondNotFound / respondAppNotFound); tests TestDeniedDownloadMatchesUnknownKey and TestPrivateDownloadAccess assert this.
- The session check runs before the mode check: an owner or allowed team user gets in on a strict app, and a session that fails is not an error, the request continues to the mode and token checks.
- On an unlisted artifact the token header is never read, because authorizeDownload returns before it.
- A private app's version response never reaches the Redis response cache (the gate runs before the cache lookup).
