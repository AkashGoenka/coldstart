---
id: no-experience-sampling-applied-to-assignments-in-this-repo
type: lesson
kind: absence
title: "no experience sampling applied to assignments in this repo"
scope: {"terms":["experience_sampling_weight","sampling","EXPERIENCE_SAMPLING_WEIGHT"]}
status: active
updated: 2026-11-16T18:23:58.157Z
edits: 1
---

# no experience sampling applied to assignments in this repo

Searched for experience_sampling_weight and sampling in app/ and config/ (excluding specs). It is read only in config/application.rb, app/models/split_registry.rb, the v4 app_identifiers and app_visitor_configs controllers, and the registry and visitor-config jbuilder views, where it is echoed to clients. Nothing in the assignment creators (DeterministicAssignmentCreation, ArbitraryAssignmentCreation, BatchArbitraryAssignmentCreation) or in api/v1/assignment_events reads it, so POST assignment_event always creates a row for a visitor who has none.

## Scope (absence — freshness = re-run this search)

- terms: `experience_sampling_weight`, `sampling`, `EXPERIENCE_SAMPLING_WEIGHT`
