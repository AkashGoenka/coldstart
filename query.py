#!/usr/bin/env python3
"""
query.py — Query your coldstart_map.json from the terminal.
No dependencies required (stdlib only).

Usage:
    python3 query.py --map coldstart_map.json --domain auth
    python3 query.py --map coldstart_map.json --file src/auth/middleware.ts
    python3 query.py --map coldstart_map.json --hot-nodes
    python3 query.py --map coldstart_map.json --cycles
    python3 query.py --map coldstart_map.json --search "jwt"
    python3 query.py --map coldstart_map.json --search "jwt" --domain auth
    python3 query.py --map coldstart_map.json --suggest-domain "authentication"
    python3 query.py --map coldstart_map.json --impact src/utils/token.ts
"""

import json
import argparse
import sys
from pathlib import Path


def load_map(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def load_patterns(map_path: str) -> dict:
    """Load patterns from separate coldstart_patterns.json file."""
    patterns_path = Path(map_path).parent / "coldstart_patterns.json"
    if not patterns_path.is_file():
        return {}
    try:
        with open(patterns_path) as f:
            data = json.load(f)
            patterns_data = data.get("patterns", {})
            # Convert from {pattern: [file_ids]} to {file_id: pattern}
            result = {}
            for pattern, file_ids in patterns_data.items():
                for file_id in file_ids:
                    result[file_id] = pattern
            return result
    except (json.JSONDecodeError, IOError):
        return {}


def _str(v) -> str:
    """JSON null → treat as empty string."""
    return v if isinstance(v, str) else ""


def _list(v) -> list:
    """JSON null or missing → empty list (node fields like exports/imports may be null)."""
    return v if isinstance(v, list) else []


def resolve_map_path(explicit: str) -> Path:
    """Prefer explicit path; if default missing, try common repo layouts."""
    p = Path(explicit)
    if p.is_file():
        return p
    if explicit != "coldstart_map.json":
        return p
    for alt in (
        Path("tools/coldstart/coldstart_map.json"),
        Path(__file__).resolve().parent / "coldstart_map.json",
    ):
        if alt.is_file():
            return alt
    return p


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
    nodes = {n["id"]: n for n in _list(data.get("nodes"))}
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
    edges = _list(data.get("edges"))
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


def cmd_search(data: dict, term: str, domain: str = None, patterns: dict = None):
    """Search file IDs, exports, and summaries for a keyword, optionally scoped to a domain."""
    term_lower = term.lower()
    results = []
    nodes = _list(data.get("nodes"))
    
    # Filter nodes by domain if specified
    if domain:
        nodes = [n for n in nodes if n.get("domain") == domain]
    
    for node in nodes:
        score = 0
        if term_lower in node["id"].lower():
            score += 3
        if any(term_lower in e.lower() for e in _list(node.get("exports"))):
            score += 2
        if term_lower in _str(node.get("domain")).lower():
            score += 1
        if term_lower in _str(node.get("summary")).lower():
            score += 1
        if score > 0:
            results.append((score, node))

    results.sort(key=lambda x: -x[0])

    if not results:
        domain_str = f" in domain '{domain}'" if domain else ""
        print(f"No results for '{term}'{domain_str}.")
        return

    domain_str = f" in domain '{domain}'" if domain else ""
    print(f"\n🔍  Search: '{term}'{domain_str}  ({len(results)} results)\n")

    # Group by pattern if patterns are available
    if not patterns:
        # Fallback: no pattern grouping
        for score, node in results[:20]:
            exports_preview = ", ".join(_list(node.get("exports"))[:3])
            print(f"   [{score}★] {node['id']}  [{node['domain']}]")
            if exports_preview:
                print(f"         exports: {exports_preview}")
        return

    pattern_order = [
        "configuration",
        "type-definition",
        "component",
        "implementation",
        "utility",
        "entry-point",
        "test",
    ]
    results_by_pattern = {p: [] for p in pattern_order}
    results_by_pattern["other"] = []

    for score, node in results:
        pattern = patterns.get(node["id"], "other")
        if pattern in results_by_pattern:
            results_by_pattern[pattern].append((score, node))
        else:
            results_by_pattern["other"].append((score, node))

    # Print in pattern order
    pattern_icons = {
        "configuration": "⚙️ ",
        "type-definition": "📝",
        "component": "🎨",
        "implementation": "⚙️ ",
        "utility": "🔧",
        "entry-point": "📍",
        "test": "✅",
    }

    printed = 0
    for pattern in pattern_order + ["other"]:
        if not results_by_pattern[pattern]:
            continue
        if printed > 0:
            print()
        icon = pattern_icons.get(pattern, "📄")
        print(f"{icon} {pattern.title()}")
        for score, node in results_by_pattern[pattern]:
            if printed >= 20:
                remaining = sum(
                    len(results_by_pattern[p])
                    for p in pattern_order + ["other"]
                    if p != pattern
                ) - (printed - len(results_by_pattern[pattern]))
                if remaining > 0:
                    print(f"   ... and {remaining} more results")
                return
            exports_preview = ", ".join(_list(node.get("exports"))[:3])
            print(f"   [{score}★] {node['id']}  [{node['domain']}]")
            if exports_preview:
                print(f"         exports: {exports_preview}")
            printed += 1


def cmd_patterns(data: dict):
    """Show file patterns and their distribution across the codebase."""
    # Load patterns from separate file
    patterns_path = Path(data.get("_map_path", "coldstart_map.json")).parent / "coldstart_patterns.json"
    
    if not patterns_path.is_file():
        print("⚠️   Pattern metadata not found.")
        print(f"    Expected: {patterns_path}")
        return
    
    try:
        with open(patterns_path) as f:
            patterns_data = json.load(f).get("patterns", {})
    except (json.JSONDecodeError, IOError):
        print("⚠️   Could not load pattern metadata.")
        return
    
    if not patterns_data:
        print("⚠️   No patterns found in metadata file.")
        return
    
    pattern_icons = {
        "configuration": "⚙️ ",
        "type-definition": "📝",
        "component": "🎨",
        "implementation": "⚙️ ",
        "utility": "🔧",
        "entry-point": "📍",
        "test": "✅",
    }
    
    pattern_descriptions = {
        "configuration": "Options, settings, flags, and configuration objects",
        "type-definition": "Types, interfaces, enums, constants, and type definitions",
        "component": "React/Vue components, pages, layouts, and views",
        "implementation": "Business logic, algorithms, handlers, and services",
        "utility": "Helpers, adapters, services, formatters, and utilities",
        "entry-point": "Index files, main entry points, and re-exports",
        "test": "Test suites, mocks, fixtures, and test helpers",
    }
    
    print("\n📊  Code Patterns Distribution\n")
    
    sorted_patterns = sorted(
        [(p, len(ids)) for p, ids in patterns_data.items()],
        key=lambda x: -x[1]
    )
    
    max_count = max([count for _, count in sorted_patterns]) if sorted_patterns else 1
    
    for pattern, count in sorted_patterns:
        icon = pattern_icons.get(pattern, "📄")
        bar = "█" * max(1, min(count // max(1, max_count // 30), 30))
        description = pattern_descriptions.get(pattern, "")
        
        print(f"{icon} {pattern.title():20} {count:5d}  {bar}")
        if description:
            print(f"   {description}\n")


def cmd_impact(data: dict, file_id: str):
    """Show what breaks if this file changes (reverse traversal)."""
    edges = _list(data.get("edges"))

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
    nodes = [n for n in _list(data.get("nodes")) if n.get("language") == "graphql"]
    ts_apollo = [n for n in _list(data.get("nodes")) if
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


def cmd_hooks(data: dict):
    """List all files that export React hooks, sorted by hook count."""
    nodes = [n for n in _list(data.get("nodes")) if _list(n.get("hook_names"))]
    if not nodes:
        print("No React hook files found.")
        print("(Hooks are detected when package.json lists react as a dependency.)")
        return
    nodes.sort(key=lambda n: -len(n["hook_names"]))
    print(f"\n🪝  React Hooks  ({len(nodes)} files)\n")
    for n in nodes:
        hooks = ", ".join(n["hook_names"])
        print(f"   {n['id']}  [{n.get('domain', '')}]")
        print(f"      {hooks}")


def cmd_summary(data: dict):
    """Print a compact summary of the entire codebase map."""
    meta = data.get("meta", {})
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


def cmd_suggest_domain(data: dict, search_term: str):
    """Suggest domains based on keyword matching in file paths and summaries."""
    term_lower = search_term.lower()
    domain_scores = {}
    
    for node in _list(data.get("nodes")):
        domain = node.get("domain", "unknown")
        score = 0
        
        # Match in file path
        if term_lower in node["id"].lower():
            score += 2
        
        # Match in summary
        if term_lower in _str(node.get("summary")).lower():
            score += 1
        
        # Match in exports
        if any(term_lower in e.lower() for e in _list(node.get("exports"))):
            score += 1
        
        if score > 0:
            domain_scores[domain] = domain_scores.get(domain, 0) + score
    
    if not domain_scores:
        print(f"\nNo domain suggestions for '{search_term}'.")
        print("Try a different search term or browse domains with --domain <name>")
        return
    
    # Sort by score
    sorted_domains = sorted(domain_scores.items(), key=lambda x: -x[1])
    
    print(f"\n💡  Suggested domains for '{search_term}':\n")
    for i, (domain, score) in enumerate(sorted_domains[:10], 1):
        bar = "█" * min(score, 15)
        file_count = len(data.get("clusters", {}).get(domain, []))
        print(f"   {i}. {domain:<30} {bar} ({score} matches, {file_count} files)")
    
    print(f"\n   Try: python3 query.py --domain {sorted_domains[0][0]}")
    print(f"   Then: python3 query.py --search '{search_term}' --domain {sorted_domains[0][0]}")


def main():
    parser = argparse.ArgumentParser(
        description="Query your coldstart_map.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--map", default="coldstart_map.json", help="Path to coldstart_map.json")
    parser.add_argument("--domain", help="List files in a domain cluster")
    parser.add_argument("--file", help="Show metadata for a specific file")
    parser.add_argument("--hot", "--hot-nodes", action="store_true", help="Show hot nodes (most imported)")
    parser.add_argument("--cycles", action="store_true", help="Show circular dependencies")
    parser.add_argument("--search", help="Search file IDs, exports, and summaries")
    parser.add_argument("--suggest-domain", help="Suggest domains based on search term")
    parser.add_argument("--impact", help="Show files affected if this file changes")
    parser.add_argument("--gql", action="store_true", help="Show all GraphQL definitions")
    parser.add_argument("--hooks", action="store_true", help="List files that export React hooks")
    parser.add_argument("--patterns", action="store_true", help="Show code pattern distribution")
    parser.add_argument("--summary", action="store_true", help="Print codebase summary")
    args = parser.parse_args()

    map_path = resolve_map_path(args.map)
    if not map_path.is_file():
        print(f"❌  Map file not found: {args.map}", file=sys.stderr)
        print("    Tried repo root coldstart_map.json and tools/coldstart/coldstart_map.json", file=sys.stderr)
        print("    Run the indexer first: ./coldstart --root ./your-project", file=sys.stderr)
        sys.exit(1)

    data = load_map(str(map_path))
    data["_map_path"] = str(map_path)  # Store path for pattern loading
    
    # Load patterns (only if needed)
    patterns = None
    if args.search or args.patterns:
        patterns = load_patterns(str(map_path))

    # --summary first: wins over other flags if multiple are passed
    if args.summary:
        cmd_summary(data)
    elif args.suggest_domain:
        cmd_suggest_domain(data, args.suggest_domain)
    elif args.patterns:
        cmd_patterns(data)
    elif args.domain:
        cmd_domain(data, args.domain)
    elif args.file:
        cmd_file(data, args.file)
    elif args.hot:
        cmd_hot(data)
    elif args.cycles:
        cmd_cycles(data)
    elif args.search:
        cmd_search(data, args.search, domain=args.domain, patterns=patterns)
    elif args.impact:
        cmd_impact(data, args.impact)
    elif args.gql:
        cmd_gql(data)
    elif args.hooks:
        cmd_hooks(data)
    else:
        cmd_summary(data)


if __name__ == "__main__":
    main()
