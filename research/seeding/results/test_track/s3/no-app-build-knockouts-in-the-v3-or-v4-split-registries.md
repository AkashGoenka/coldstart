---
id: no-app-build-knockouts-in-the-v3-or-v4-split-registries
type: lesson
kind: absence
title: "no app-build knockouts in the v3 or v4 split registries"
scope: {"terms":["SplitRegistriesController","SplitRegistry","split_registries","for_presentation","app_build","AppRemoteKill","AppFeatureCompletion"]}
status: active
updated: 2026-11-16T18:24:06.675Z
edits: 1
---

# no app-build knockouts in the v3 or v4 split registries

Searched app/ for app_build, AppVersionBuildPath, AppIdentifierClaim and for_presentation(app_build:). The only files that reference an app build are api/v1 app_visitor_configs and app_identifier_visitor_configs, api/v4 app_visitor_configs and app_identifiers, and the models behind them. api/v3 and api/v4 SplitRegistriesController#show build SplitRegistry from the build_timestamp parameter, and SplitRegistry#splits is only Split.active(as_of:), so AppFeatureCompletion and AppRemoteKill knockouts are never applied on those routes. api/v2 uses Time.zone.now and api/v1 uses for_presentation with no build; neither applies app-build knockouts.

## Scope (absence — freshness = re-run this search)

- terms: `SplitRegistriesController`, `SplitRegistry`, `split_registries`, `for_presentation`, `app_build`, `AppRemoteKill`, `AppFeatureCompletion`
