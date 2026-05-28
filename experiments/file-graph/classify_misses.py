#!/usr/bin/env python3
"""Classify the edges coldstart missed (standalone-only) by root cause.

For each missed edge src->tgt, re-parse src and find the import statement(s)
that the standalone builder would have used to produce tgt, then bucket:
  - "from pkg import submodule"  -> coldstart records only `pkg`, loses tgt
  - "nested/deferred import"     -> import not at module top level
  - "other"
"""
import ast, json, os, sys
from collections import Counter

root = os.path.abspath(sys.argv[1])  # arches-repo
std = json.load(open(sys.argv[2]))
cold = json.load(open(sys.argv[3]))

def py_edges(g):
    return {(a, b) for a, b in g["edges"] if a.endswith(".py") and b.endswith(".py")}

nodes = {n for n in std["nodes"] if n.endswith(".py")} & {n for n in cold["nodes"] if n.endswith(".py")}
std_e = {(a, b) for a, b in py_edges(std) if a in nodes and b in nodes}
cold_e = {(a, b) for a, b in py_edges(cold) if a in nodes and b in nodes}
missed = std_e - cold_e

# module dotted -> relpath, mirroring the standalone builder
def module_name_for(rel):
    parts = rel[:-3].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)
index = {}
for rel in std["nodes"]:
    if rel.endswith(".py"):
        index[module_name_for(rel)] = rel

buckets = Counter()
missed_by_src = {}
for a, b in missed:
    missed_by_src.setdefault(a, set()).add(b)

for src, tgts in missed_by_src.items():
    try:
        tree = ast.parse(open(os.path.join(root, src)).read())
    except Exception:
        for _ in tgts: buckets["unparseable"] += 1
        continue
    # map: target relpath -> list of (is_toplevel, is_submodule_name)
    toplevel_lines = {n.lineno for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        is_top = node.lineno in toplevel_lines
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            base = node.module
            base_file = index.get(base)
            for al in node.names:
                sub = index.get(f"{base}.{al.name}")
                if sub in tgts:
                    buckets["from_pkg_import_submodule" if is_top else "nested_import"] += 1
            # base module edge missed?
            if base_file in tgts:
                buckets["base_module" if is_top else "nested_import"] += 1
        elif isinstance(node, ast.Import):
            for al in node.names:
                if index.get(al.name) in tgts:
                    buckets["plain_import" if is_top else "nested_import"] += 1
        elif isinstance(node, ast.ImportFrom):  # relative
            buckets["relative_import"] += 1

print(f"missed edges: {len(missed)}")
for k, v in buckets.most_common():
    print(f"  {v:4d}  {k}")
