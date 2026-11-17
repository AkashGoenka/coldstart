---
id: how-checkversion-shapes-the-response-per-updater-type-2
type: flow
title: "how /checkVersion shapes the response per updater type"
anchors:
  - {"path":"server/utils/validate.go","hash":"sha256:8046aac4b51c","head":"ca2f88a4fe38"}
  - {"path":"server/utils/check.go","hash":"sha256:7b5c4e0b5f69","head":"ca2f88a4fe38"}
  - {"path":"mongod/check.go","hash":"sha256:34fd1ceea134","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest.go","hash":"sha256:f71401ab7170","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/updaters.go","hash":"sha256:ddfdb868efcf","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/squirrel.go","hash":"sha256:f68b114b97d9","head":"ca2f88a4fe38"}
  - {"path":"server/utils/updaters/tauri.go","hash":"sha256:b241ceb9306a","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/latest_edge.go","hash":"sha256:a050c1a044b8","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:25:39.504Z
edits: 1
---

# how /checkVersion shapes the response per updater type

The status code and body are chosen in two places: mongod/check.go sets Found/PossibleRollback, and updaters.BuildResponse maps those flags to a status and body per updater type. latest.go can then replace the squirrel_windows 302 with a RELEASES text body. The not-found path with no artifacts skips BuildResponse entirely and returns 200 JSON. The updater BuildResponse switches on is the DB updater type that CheckPlatformsLatest resolves, not the raw query string.

## Steps

1. `server/utils/validate.go` (`ValidateParamsLatest`) — normalizes version ("-" to ".") and replaces the raw updater and platform with what CheckPlatformsLatest resolves from apps_meta
2. `server/utils/check.go` (`CheckPlatformsLatest`) — empty updater resolves to the apps_meta updater entry with default:true; a requested name matches exactly or by prefix ("squirrel" matches squirrel_darwin or squirrel_windows)
3. `mongod/check.go` (`CheckLatestVersion`) — computes Found, PossibleRollback, IsRequiredIntermediate and LatestVersion from the requested version against the latest app version
4. `server/handler/info/latest.go` (`FindLatestVersion`) — handler: not-found with no artifacts returns 200 {update_available:false,error:"Not found"} without BuildResponse; otherwise BuildArtifactUrls, changelog, then updaters.BuildResponse; rollout added after it, found branch only
5. `server/utils/updaters/updaters.go` (`BuildResponse`) — per-updater switch: 204 for no update (squirrel_darwin, electron-builder, tauri), 302 for squirrel_windows and electron-builder, tauri 200 JSON body, default passes the map through with 200
6. `server/handler/info/latest.go` (`maybeSquirrelReleasesFeed`, `buildSquirrelReleasesFeed`) — for squirrel_windows 302 with a non-private URL, reads the RELEASES object from storage and returns it as text/plain 200; on any error logs and keeps the 302
7. `server/utils/updaters/squirrel.go` (`RewriteReleasesToAbsoluteURLs`) — rewrites the filename column of each RELEASES line to baseURL + "/" + filename
8. `server/utils/updaters/tauri.go` (`tauriUpdateURL`) — picks the update_url_* payload by fixed priority (sig and dmg excluded)
9. `server/handler/info/latest_edge.go` (`publishResponseToCDN`) — CDN publish receives the response map that FindLatestVersion passes (pre-RELEASES rewrite), not the squirrel body

## Invariants

- The status code decides the body: a 204 or 302 from BuildResponse is never sent with the JSON body the handler built earlier.
- The Redis cache stores the post-BuildResponse result (for squirrel_windows, the RELEASES body plus content type), keyed by updater; a private app (access.Private) is never read from or written to the cache.
- The found-branch rollout field is attached after BuildResponse, so it appears in tauri and default JSON bodies but is ignored for redirects and 204s.
