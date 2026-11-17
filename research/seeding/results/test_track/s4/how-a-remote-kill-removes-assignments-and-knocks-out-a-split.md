---
id: how-a-remote-kill-removes-assignments-and-knocks-out-a-split
type: flow
title: "how a remote kill removes assignments and knocks out a split's weights"
anchors:
  - {"path":"app/models/app_remote_kill.rb","hash":"sha256:80438d1e1e43","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/models/assignment.rb","hash":"sha256:12c667a32db6","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:24:48.742Z
edits: 1
---

# how a remote kill removes assignments and knocks out a split's weights

One AppRemoteKill row drives two effects, and both are gated on an app_build being passed: Assignment.for_presentation drops assignments on the killed split, and Split.registry is rewritten to 100% on override_to. Without an app_build (Assignment.for_presentation with no argument, or a plain Split.find(...).registry) nothing is killed. Every filter goes through AppRemoteKill.affecting, so changing the kill rule means changing that one scope.

## Steps

1. `app/models/app_remote_kill.rb` (`affecting`, `overlapping`) — the single predicate: app match, first_bad_version <= build version, and fixed_version null or greater than it; no override or timestamp term
2. `app/models/split.rb` (`with_remote_kill_knockouts_for`, `registry`, `arel_excluding_remote_kills_for`) — for_app_build selects the kill's override_to as a virtual remote_kill_override_to column, and registry knocks weights to that variant when the column is present
3. `app/models/assignment.rb` (`for_presentation`, `for_app_build`, `excluding_remote_kills_for`) — for_presentation only applies kills when app_build is given; excluding_remote_kills_for removes assignments whose split has a matching kill

## Invariants

- A remote kill is not overridden by force, by a later assignment, or by updated_at: AppRemoteKill.affecting has no such term and no code in app/ or lib/ references overridden_at.
- must_not_overlap_existing rejects two kills on the same app and split whose version ranges overlap, so at most one kill matches a build per split.
- A kill whose override_to names a variant that the split does not have is a no-op at runtime (see split.rb knock_out_weightings), it does not raise.
