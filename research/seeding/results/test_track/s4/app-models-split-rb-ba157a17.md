---
id: app-models-split-rb-ba157a17
type: file
character: hub
title: "app/models/split.rb"
anchors:
  - {"path":"app/models/split.rb","symbols":["with_remote_kill_knockouts_for","registry","knock_out_weightings","arel_excluding_remote_kills_for","arel_excluding_incomplete_features_for","with_feature_incomplete_knockouts_for","except_feature_gates"],"hash":"sha256:be48535987fc","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:53.039Z
edits: 2
---

# app/models/split.rb

Remote kill knockouts exist only on relations built with for_app_build: with_remote_kill_knockouts_for adds a virtual remote_kill_override_to column, and registry reads it with try, so a Split loaded without that scope returns its stored weights. knock_out_weightings sets the override_to variant to 100 and the rest to 0, and if the variant is missing it logs an error and returns the original registry (ADR doc/arch/adr-001.md: the override is not validated against the split).

## Facets

- **arel_excluding_incomplete_features_for** — A public class method, not private: the predicate is true for non-gates or gates with an AppFeatureCompletion at or below the build version. Assignment.excluding_incomplete_features_for ORs it with force, and with_feature_incomplete_knockouts_for negates it, so one edit changes both the assignment filter and the registry knockout.
- **with_feature_incomplete_knockouts_for** — Adds a feature_incomplete column; registry then rewrites the weights so the variant named 'false' gets 100 and the rest 0. The knockout ignores assignment force, so forced assignments to an incomplete gate still show here at weight 0.
- **except_feature_gates** — where(feature_gate: false). It is the gate test used by Assignment.except_feature_gates.
