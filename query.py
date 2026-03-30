#!/usr/bin/env python3
"""
query.py — Query your coldstart_map.json from the terminal.
No dependencies required (stdlib only).

Usage:
    python query.py --map coldstart_map.json --domain auth
    python query.py --map coldstart_map.json --file src/auth/middleware.ts
    python query.py --map coldstart_map.json --hot
    python query.py --map coldstart_map.json --cycles
    python query.py --map coldstart_map.json --search "jwt"
    python query.py --map coldstart_map.json --impact src/utils/token.ts
"""

import json
import argparse
import sys
from pathlib import Path


def load_map(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def cmd_domain(data: dict, domain: str):
    """List all files in a domain cluster."""
    clusters = data.get("clusters", {})
    files = clusters.get(domain, [])
    if not files:
        available = list(clusters.keys())
        print(f"No domain '{domain}' found. Available: {', '.join(sorted(available))}")
        return
    print(f"\n📦  Domain: {domain}  ({len(files)} files)\n")
    for f in sorted(files):
        print(f"   {f}")


def cmd_file(data: dict, file_id: str):
    """Show full metadata for a specific file."""
    nodes = {n["id"]: n for n in data.get("nodes", [])}
    node = nodes.get(file_id)
    if not node:
        # Try partial match
        matches = [n for n in nodes if file_id in n]
        if len(matches) == 1:
            node = nodes[matches[0]]
        elif len(matches) > 1:
            print(f"Multiple matches for '{file_id}':")
            for m in matches:
                print(f"   {m}")
            return
        else:
            print(f"File not found: {file_id}")
            return

    # Build dependency/dependent lists from edges
    edges = data.get("edges", [])
    deps = [e["to"] for e in edges if e["from"] == node["id"]]
    dependents = [e["from"] for e in edges if e["to"] == node["id"]]

    print(f"\n📄  {node['id']}")
    print(f"   Language:  {node['language']}")
    print(f"   Domain:    {node['domain']}")
    print(f"   Lines:     {node['line_count']}")
    print(f"   Tokens:    ~{node['token_estimate']}")
    print(f"   Entry pt:  {node['is_entry_point']}")
    print(f"   Hash:      {node['hash']}")
    print(f"\n   Summary:   {node['summary']}")

    if node.get("exports"):
        print(f"\n   Exports ({len(node['exports'])}):")
        for e in node["exports"]:
            print(f"      • {e}")

    # GQL-specific detail
    gql = node.get("gql")
    if gql:
        print(f"\n   GraphQL")
        print(f"      Schema file:   {gql.get('is_schema', False)}")
        if gql.get("types_defined"):
            print(f"      Types:         {', '.join(gql['types_defined'])}")
        if gql.get("queries"):
            print(f"      Queries:       {', '.join(gql['queries'])}")
        if gql.get("mutations"):
            print(f"      Mutations:     {', '.join(gql['mutations'])}")
        if gql.get("subscriptions"):
            print(f"      Subscriptions: {', '.join(gql['subscriptions'])}")
        if gql.get("fragments"):
            print(f"      Fragments:     {', '.join(gql['fragments'])}")
        if gql.get("inputs"):
            print(f"      Inputs:        {', '.join(gql['inputs'])}")
        if gql.get("enums"):
            print(f"      Enums:         {', '.join(gql['enums'])}")
        if gql.get("interfaces"):
            print(f"      Interfaces:    {', '.join(gql['interfaces'])}")
        if gql.get("unions"):
            print(f"      Unions:        {', '.join(gql['unions'])}")

    if deps:
        print(f"\n   Imports ({len(deps)} resolved):")
        for d in sorted(deps):
            print(f"      → {d}")

    if dependents:
        print(f"\n   Depended on by ({len(dependents)}):")
        for d in sorted(dependents):
            print(f"      ← {d}")


def cmd_hot(data: dict):
    """Show the most imported files (hot nodes)."""
    hot = data.get("hot_nodes", [])
    if not hot:
        print("No hot nodes found (threshold: 5+ dependents).")
        return
    print(f"\n🔥  Hot Nodes — imported by 5+ files\n")
    for node in hot:
        bar = "█" * min(node["dependents"], 30)
        print(f"   {node['dependents']:3d}  {bar}  {node['id']}  [{node['domain']}]")


def cmd_cycles(data: dict):
    """Show circular dependencies."""
    cycles = data.get("cycles", [])
    if not cycles:
        print("✅  No circular dependencies detected.")
        return
    print(f"\n⚠️   Circular Dependencies ({len(cycles)} found)\n")
    for i, cycle in enumerate(cycles, 1):
        print(f"   {i}. {' → '.join(cycle)}")


def cmd_search(data: dict, term: str):
    """Search file IDs, exports, and summaries for a keyword."""
    term_lower = term.lower()
    results = []
    for node in data.get("nodes", []):
        score = 0
        if term_lower in node["id"].lower():
            score += 3
        if any(term_lower in e.lower() for e in node.get("exports", [])):
            score += 2
        if term_lower in node.get("domain", "").lower():
            score += 1
        if term_lower in node.get("summary", "").lower():
            score += 1
        if score > 0:
            results.append((score, node))

    results.sort(key=lambda x: -x[0])

    if not results:
        print(f"No results for '{term}'.")
        return

    print(f"\n🔍  Search: '{term}'  ({len(results)} results)\n")
    for score, node in results[:20]:
        exports_preview = ", ".join(node.get("exports", [])[:3])
        print(f"   [{score}★] {node['id']}  [{node['domain']}]")
        if exports_preview:
            print(f"         exports: {exports_preview}")


def cmd_impact(data: dict, file_id: str):
    """Show what breaks if this file changes (reverse traversal)."""
    edges = data.get("edges", [])

    # Build reverse adjacency map
    rev = {}
    for e in edges:
        rev.setdefault(e["to"], []).append(e["from"])

    # BFS from file_id
    visited = set()
    queue = [file_id]
    levels = {}

    while queue:
        current = queue.pop(0)
        for importer in rev.get(current, []):
            if importer not in visited:
                visited.add(importer)
                levels[importer] = levels.get(current, 0) + 1
                queue.append(importer)

    if not visited:
        print(f"No files depend on '{file_id}'.")
        return

    print(f"\n💥  Impact of changing: {file_id}")
    print(f"    {len(visited)} file(s) affected\n")

    by_level = {}
    for f, lvl in levels.items():
        by_level.setdefault(lvl, []).append(f)

    for lvl in sorted(by_level):
        label = "direct" if lvl == 1 else f"level {lvl}"
        for f in sorted(by_level[lvl]):
            print(f"   {'→' * lvl} {f}  ({label})")


def cmd_gql(data: dict):
    """Show all GraphQL definitions across the codebase."""
    nodes = [n for n in data.get("nodes", []) if n.get("language") == "graphql"]
    ts_apollo = [n for n in data.get("nodes", []) if
                 n.get("domain") in ("graphql-operations", "graphql-schema") and
                 n.get("language") != "graphql"]

    if not nodes and not ts_apollo:
        print("No GraphQL files found in the map.")
        return

    print(f"\n🔷  GraphQL Surface\n")

    # Schema files first
    schema_files = [n for n in nodes if n.get("gql", {}).get("is_schema")]
    if schema_files:
        print(f"   Schema files ({len(schema_files)}):")
        for n in schema_files:
            gql = n.get("gql", {})
            types = ", ".join(gql.get("types_defined", [])[:5])
            print(f"      {n['id']}")
            if types:
                print(f"         types: {types}")

    # Operations
    op_files = [n for n in nodes if not n.get("gql", {}).get("is_schema") and
                (n.get("gql", {}).get("queries") or
                 n.get("gql", {}).get("mutations") or
                 n.get("gql", {}).get("subscriptions"))]
    if op_files:
        print(f"\n   Operation files ({len(op_files)}):")
        for n in op_files:
            gql = n.get("gql", {})
            queries = gql.get("queries", [])
            mutations = gql.get("mutations", [])
            subs = gql.get("subscriptions", [])
            print(f"      {n['id']}")
            if queries:
                print(f"         queries:   {', '.join(queries)}")
            if mutations:
                print(f"         mutations: {', '.join(mutations)}")
            if subs:
                print(f"         subs:      {', '.join(subs)}")

    # Fragment files
    frag_files = [n for n in nodes if n.get("gql", {}).get("fragments")]
    if frag_files:
        print(f"\n   Fragment files ({len(frag_files)}):")
        for n in frag_files:
            frags = ", ".join(n.get("gql", {}).get("fragments", []))
            print(f"      {n['id']}  →  {frags}")

    # Apollo TS/JS files
    if ts_apollo:
        print(f"\n   Apollo usage in TS/JS ({len(ts_apollo)} files):")
        for n in ts_apollo:
            print(f"      {n['id']}  [{n.get('domain', '')}]")


def cmd_summary(data: dict):
    """Print a compact summary of the entire codebase map."""
    meta = data.get("meta", {})
    stats = data.get("stats", {})
    clusters = data.get("clusters", {})

    print(f"\n🗺️   Codebase Map Summary")
    print(f"   Generated:    {meta.get('generated_at', 'unknown')}")
    print(f"   Root:         {meta.get('root_dir', '.')}")
    print(f"   Indexer:      v{meta.get('indexer_version', '?')}")
    print(f"\n   Files:        {meta.get('total_files', 0)}")
    print(f"   Edges:        {meta.get('total_edges', 0)}")
    print(f"   Total tokens: ~{meta.get('total_tokens', 0):,}")
    print(f"\n   Domains ({len(clusters)}):")
    for domain, files in sorted(clusters.items(), key=lambda x: -len(x[1])):
        bar = "█" * min(len(files), 20)
        print(f"      {len(files):4d}  {bar}  {domain}")


def main():
    parser = argparse.ArgumentParser(
        description="Query your coldstart_map.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--map", default="coldstart_map.json", help="Path to coldstart_map.json")
    parser.add_argument("--domain", help="List files in a domain cluster")
    parser.add_argument("--file", help="Show metadata for a specific file")
    parser.add_argument("--hot", action="store_true", help="Show hot nodes (most imported)")
    parser.add_argument("--cycles", action="store_true", help="Show circular dependencies")
    parser.add_argument("--search", help="Search file IDs, exports, and summaries")
    parser.add_argument("--impact", help="Show files affected if this file changes")
    parser.add_argument("--gql", action="store_true", help="Show all GraphQL definitions")
    parser.add_argument("--summary", action="store_true", help="Print codebase summary")
    args = parser.parse_args()

    map_path = Path(args.map)
    if not map_path.exists():
        print(f"❌  Map file not found: {args.map}")
        print("    Run the indexer first: ./coldstart --root ./your-project")
        sys.exit(1)

    data = load_map(str(map_path))

    if args.domain:
        cmd_domain(data, args.domain)
    elif args.file:
        cmd_file(data, args.file)
    elif args.hot:
        cmd_hot(data)
    elif args.cycles:
        cmd_cycles(data)
    elif args.search:
        cmd_search(data, args.search)
    elif args.impact:
        cmd_impact(data, args.impact)
    elif args.gql:
        cmd_gql(data)
    else:
        cmd_summary(data)


if __name__ == "__main__":
    main()