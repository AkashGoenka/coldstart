#!/usr/bin/env python3
"""
Compare the standalone Python dep-graph against coldstart's exported graph.

Both graphs are restricted to the same universe: .py files that survive the
shared exclusion rules. We then diff the edge sets and surface where the two
resolvers agree and disagree -- the disagreements are the interesting part,
since the standalone graph acts as an independent oracle.

Usage: python3 compare.py arches_standalone.json arches_coldstart.json [report.md]
"""

import json
import sys
from collections import defaultdict


def load(path):
    with open(path) as fh:
        return json.load(fh)


def py_nodes(g):
    return {n for n in g["nodes"] if n.endswith(".py")}


def py_edges(g, universe):
    return {
        (a, b)
        for a, b in g["edges"]
        if a.endswith(".py") and b.endswith(".py") and a in universe and b in universe
    }


def indeg(edges):
    d = defaultdict(int)
    for _, b in edges:
        d[b] += 1
    return d


def outdeg(edges):
    d = defaultdict(int)
    for a, _ in edges:
        d[a] += 1
    return d


def top(d, n=15):
    return sorted(d.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    std = load(sys.argv[1])
    cold = load(sys.argv[2])
    report_path = sys.argv[3] if len(sys.argv) > 3 else "comparison.md"

    std_nodes = py_nodes(std)
    cold_nodes = py_nodes(cold)
    universe = std_nodes & cold_nodes

    std_e = py_edges(std, universe)
    cold_e = py_edges(cold, universe)

    both = std_e & cold_e
    std_only = std_e - cold_e
    cold_only = cold_e - std_e
    union = std_e | cold_e

    jaccard = len(both) / len(union) if union else 1.0

    std_in = indeg(std_e)
    cold_in = indeg(cold_e)

    lines = []
    w = lines.append
    w("# Standalone vs coldstart: arches file-dependency graph\n")
    w("## Node universe (.py, shared exclusions)\n")
    w(f"- standalone files: **{len(std_nodes)}**")
    w(f"- coldstart .py files: **{len(cold_nodes)}**")
    w(f"- shared universe (compared on): **{len(universe)}**")
    only_std_nodes = std_nodes - cold_nodes
    only_cold_nodes = cold_nodes - std_nodes
    w(f"- only standalone saw: {len(only_std_nodes)}  |  only coldstart saw: {len(only_cold_nodes)}")
    if only_std_nodes:
        w(f"  - e.g. standalone-only: {sorted(only_std_nodes)[:5]}")
    if only_cold_nodes:
        w(f"  - e.g. coldstart-only: {sorted(only_cold_nodes)[:5]}")
    w("")

    w("## Edge agreement\n")
    w(f"- standalone edges: **{len(std_e)}**")
    w(f"- coldstart edges: **{len(cold_e)}**")
    w(f"- agreed (in both): **{len(both)}**")
    w(f"- standalone-only (coldstart missed): **{len(std_only)}**")
    w(f"- coldstart-only (standalone missed): **{len(cold_only)}**")
    w(f"- **Jaccard similarity: {jaccard:.3f}**")
    w("")

    w("## Edges coldstart missed (sample of standalone-only)\n")
    for a, b in sorted(std_only)[:30]:
        w(f"- `{a}` -> `{b}`")
    w("")

    w("## Edges only coldstart found (sample of coldstart-only)\n")
    for a, b in sorted(cold_only)[:30]:
        w(f"- `{a}` -> `{b}`")
    w("")

    w("## Top hubs by in-degree (most depended-upon)\n")
    w("### standalone")
    for f, c in top(std_in):
        w(f"- {c:4d}  {f}")
    w("\n### coldstart")
    for f, c in top(cold_in):
        w(f"- {c:4d}  {f}")
    w("")

    report = "\n".join(lines)
    with open(report_path, "w") as fh:
        fh.write(report)

    # Console summary
    print(f"shared .py nodes: {len(universe)}")
    print(f"standalone edges: {len(std_e)}  coldstart edges: {len(cold_e)}")
    print(f"agreed: {len(both)}  std-only: {len(std_only)}  cold-only: {len(cold_only)}")
    print(f"Jaccard: {jaccard:.3f}")
    print(f"report -> {report_path}")


if __name__ == "__main__":
    main()
