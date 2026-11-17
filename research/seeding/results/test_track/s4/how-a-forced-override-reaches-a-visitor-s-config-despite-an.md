---
id: how-a-forced-override-reaches-a-visitor-s-config-despite-an
type: flow
title: "how a forced override reaches a visitor's config despite an incomplete feature gate"
anchors:
  - {"path":"app/controllers/api/v1/assignment_overrides_controller.rb","hash":"sha256:5a0ed523d1f7","head":"435fea8235b5"}
  - {"path":"app/models/arbitrary_assignment_creation.rb","hash":"sha256:9030d1560e1c","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/controllers/api/v4/app_visitor_configs_controller.rb","hash":"sha256:cefde9af9fc3","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/app_visitor_configs/_show.json.jbuilder","hash":"sha256:c14723406673","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:53.022Z
edits: 1
---

# how a forced override reaches a visitor's config despite an incomplete feature gate

A forced assignment (force = true) stays in the visitor's presented assignments for a feature gate the app build has not completed, but the same v4 response still knocks that gate's registry out to the 'false' variant. Clients therefore receive a variant from the assignments list that the splits list no longer offers at full weight. Force bypasses only the feature-gate check, never remote kills.

## Steps

1. `app/controllers/api/v1/assignment_overrides_controller.rb` (`create`) — the override endpoint always passes force: true to ArbitraryAssignmentCreation
2. `app/models/arbitrary_assignment_creation.rb` (`assignment_attrs`) — writes force onto the assignment row
3. `app/models/assignment.rb` (`excluding_incomplete_features_for`, `excluding_remote_kills_for`) — feature-gate filter is (force = true) OR the split predicate; the remote-kill filter has no force branch
4. `app/models/split.rb` (`arel_excluding_incomplete_features_for`, `with_feature_incomplete_knockouts_for`) — the same predicate, negated, sets the feature_incomplete flag; registry then knocks the weights out to 'false' at 100 and ignores force
5. `app/controllers/api/v4/app_visitor_configs_controller.rb` (`show`) — returns Split.for_presentation(app_build:) and visitor.assignments_for(app_build) side by side
6. `app/views/api/v4/app_visitor_configs/_show.json.jbuilder` — renders the splits with their registry (knocked out) and the visitor's assignments as separate arrays

## Invariants

- The feature-gate predicate is one SQL fragment used on both sides (assignment filter and split knockout); changing it changes both at once.
- Force must bypass remote kills only if excluding_remote_kills_for is changed too; today it does not.
- A feature gate whose registry has no 'false' variant is not knocked out: the knockout logs an error and returns the original registry.
