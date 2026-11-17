---
id: how-the-split-registry-timestamp-is-validated-and-used-as-th
type: flow
title: "how the split registry timestamp is validated and used as the as_of cutoff"
anchors:
  - {"path":"app/controllers/api/v4/split_registries_controller.rb","hash":"sha256:7547d5cd6d61","head":"435fea8235b5"}
  - {"path":"app/models/split_registry.rb","hash":"sha256:ac15065aefdf","head":"435fea8235b5"}
  - {"path":"app/models/split.rb","hash":"sha256:be48535987fc","head":"435fea8235b5"}
  - {"path":"app/views/api/v4/split_registries/show.json.jbuilder","hash":"sha256:37bceea7f7fb","head":"435fea8235b5"}
status: active
updated: 2026-11-16T18:23:32.787Z
edits: 1
---

# how the split registry timestamp is validated and used as the as_of cutoff

The timestamp is checked for shape only: the regex never checks that the date exists (month 13 passes), it leaves the decimal point unescaped so any character matches there, and it accepts fractional seconds of any length. The strictness is about form: a space separator, a zone without a colon, or a missing zone is rejected, and the comment in SplitRegistry says the aim is high-precision ISO 8601 timestamps from clients. Only v3 and v4 read build_timestamp; v2 ignores it and uses the current time.

## Steps

1. `app/controllers/api/v4/split_registries_controller.rb` (`show`, `split_registry_params`) — Permits build_timestamp, builds SplitRegistry with it, and renders 422 with the errors when it is invalid.
2. `app/models/split_registry.rb` (`SplitRegistry`, `splits`) — Validates presence and the format regex on as_of; splits passes as_of to Split.active.
3. `app/models/split.rb` (`active`) — With as_of: finished_at is null or later than as_of. With nil: finished_at is null.
4. `app/views/api/v4/split_registries/show.json.jbuilder` (`registry`) — Renders name, weight per variant and feature_gate for each active split.

## Invariants

- as_of is compared only against finished_at, so a decided but unfinished split is returned for any valid as_of.
- A blank or missing build_timestamp fails presence and returns 422 (the v4 spec covers the blank case).
