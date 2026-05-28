#!/usr/bin/env python3
"""
Clean-room file-dependency graph for a Python repo.

Deliberately independent of coldstart: walk every .py file, parse its imports
with the stdlib `ast`, resolve each import to a real file on disk, and emit a
file -> file edge. Only edges whose target lives inside the repo are kept
(stdlib / third-party imports are dropped on purpose). Tests and migrations are
excluded so the picture stays legible.

Output: JSON { meta, nodes: [relpath...], edges: [[from, to]...] }
Usage:  python3 standalone_pygraph.py <repo_root> [out.json]
"""

import ast
import json
import os
import sys

# Directory names whose subtrees are skipped entirely.
EXCLUDE_DIRS = {
    "migrations", "tests", "test",
    ".git", "node_modules", "venv", ".venv", "__pycache__",
    "build", "dist", ".tox", ".mypy_cache", "docs",
}


def is_excluded(relpath: str) -> bool:
    parts = relpath.split(os.sep)
    return any(p in EXCLUDE_DIRS for p in parts[:-1])


def walk_py_files(root: str) -> list[str]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root)
            if is_excluded(rel):
                continue
            out.append(rel.replace(os.sep, "/"))
    return out


def module_name_for(relpath: str) -> str:
    """Dotted module name a file is importable as (root == import root)."""
    no_ext = relpath[:-3]  # strip .py
    parts = no_ext.split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def build_module_index(files: list[str]) -> dict[str, str]:
    """dotted module path -> relpath. Files win ties over package __init__."""
    index: dict[str, str] = {}
    for rel in files:
        mod = module_name_for(rel)
        if not mod:
            continue
        # A concrete module file shadows a package __init__ of the same name.
        if mod not in index or not rel.endswith("__init__.py"):
            index[mod] = rel
    return index


def resolve(dotted: str, index: dict[str, str]) -> str | None:
    return index.get(dotted)


def current_package(relpath: str) -> list[str]:
    """The package (list of parts) that a file lives in, for relative imports."""
    parts = relpath[:-3].split("/")
    if parts[-1] == "__init__":
        return parts[:-1]
    return parts[:-1]


def extract_edges(relpath: str, root: str, index: dict[str, str]) -> tuple[set[str], int]:
    """Return (set of target relpaths, count of unresolved import statements)."""
    targets: set[str] = set()
    unresolved = 0
    try:
        with open(os.path.join(root, relpath), "r", encoding="utf-8", errors="replace") as fh:
            tree = ast.parse(fh.read(), filename=relpath)
    except (SyntaxError, ValueError):
        return targets, 0

    def add(mod: str) -> bool:
        hit = resolve(mod, index)
        if hit and hit != relpath:
            targets.add(hit)
            return True
        return bool(hit)  # resolves to self -> count as resolved, no edge

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if not add(alias.name):
                    unresolved += 1
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                pkg = current_package(relpath)
                base = pkg[: len(pkg) - (node.level - 1)] if node.level - 1 <= len(pkg) else []
                base_mod = ".".join(base + (node.module.split(".") if node.module else []))
            else:
                base_mod = node.module or ""
            if not base_mod:
                continue
            resolved_any = add(base_mod)
            # `from pkg import sub` may be a submodule rather than a name.
            for alias in node.names:
                if alias.name == "*":
                    continue
                if add(f"{base_mod}.{alias.name}"):
                    resolved_any = True
            if not resolved_any:
                unresolved += 1
    return targets, unresolved


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    root = os.path.abspath(sys.argv[1])
    out_path = sys.argv[2] if len(sys.argv) > 2 else "arches_standalone.json"

    files = walk_py_files(root)
    index = build_module_index(files)

    edges: list[list[str]] = []
    total_unresolved = 0
    for rel in files:
        targets, unresolved = extract_edges(rel, root, index)
        total_unresolved += unresolved
        for tgt in sorted(targets):
            edges.append([rel, tgt])

    edges.sort()
    result = {
        "meta": {
            "tool": "standalone_pygraph",
            "root": root,
            "language": "python",
            "files": len(files),
            "edges": len(edges),
            "unresolved_statements": total_unresolved,
            "excluded_dirs": sorted(EXCLUDE_DIRS),
        },
        "nodes": sorted(files),
        "edges": edges,
    }
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=0)
    m = result["meta"]
    print(f"[standalone] {m['files']} files, {m['edges']} edges, "
          f"{m['unresolved_statements']} unresolved import stmts -> {out_path}")


if __name__ == "__main__":
    main()
