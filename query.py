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
    python3 query.py --map coldstart_map.json --intent "membership page action menu"
    python3 query.py --map coldstart_map.json --suggest-domain "authentication"
    python3 query.py --map coldstart_map.json --impact src/utils/token.ts
"""

import json
import argparse
import sys
import re
from pathlib import Path


STOP_WORDS = {
    "a", "an", "and", "are", "can", "change", "changes", "component",
    "contains", "edit", "file", "files", "find", "for", "have", "i",
    "identify", "in", "is", "it", "item", "items", "make", "me", "of",
    "on", "or", "please", "related", "screen", "that", "the",
    "this", "to", "when", "where", "with", "you",
}

PHRASE_ALIASES = {
    "action menu": ["actionmenu", "actions", "dropdown", "kebab", "menu"],
    "membership page": ["memberships", "manage members", "member view", "membership"],
    "manage members": ["memberships", "member view", "membership"],
}

TERM_ALIASES = {
    "action": ["actions", "actionmenu", "menu"],
    "menu": ["actionmenu", "dropdown", "kebab"],
    "membership": ["memberships", "member", "members", "memberview"],
    "memberships": ["membership", "member", "members"],
    "member": ["membership", "members", "memberview"],
    "members": ["member", "membership", "memberships"],
    "page": ["view", "widget", "tab"],
    "view": ["page", "widget", "tab"],
    "tab": ["view", "page"],
}

UI_HINT_TERMS = {"page", "view", "widget", "tab", "menu", "action", "dropdown", "kebab"}
ACTION_MENU_HINT_TERMS = {"action", "actions", "actionmenu", "menu", "dropdown", "kebab"}
EDIT_HINT_TERMS = {"change", "changes", "edit", "modify", "update"}
GENERIC_PATH_TOKENS = {
    "admin", "app", "apps", "client", "common", "component", "components", "detail",
    "details", "editor", "enduser", "feature", "features", "graphql", "helpers", "hook",
    "hooks", "index", "item", "items", "list", "lists", "modal", "modals", "page", "pages",
    "provider", "providers", "query", "route", "routes", "screen", "screens", "server",
    "service", "services", "shared", "tab", "tabs", "test", "tests", "type", "types",
    "ui", "user", "users", "util", "utils", "view", "views", "widget", "widgets",
}


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


def _tokenize(text: str) -> list:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    lowered = spaced.lower().replace("/", " ").replace("_", " ").replace("-", " ")
    return [token for token in re.split(r"[^a-z0-9]+", lowered) if token]


def _normalize_term(token: str) -> str:
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith("s") and len(token) > 3 and not token.endswith("ss"):
        return token[:-1]
    return token


def _query_terms(query: str) -> dict:
    """Expand a natural-language query into weighted search terms."""
    normalized = re.sub(r"\s+", " ", query.strip().lower())
    weighted_terms = {}
    phrases = []

    if normalized:
        phrases.append((normalized, 6))

    for phrase, aliases in PHRASE_ALIASES.items():
        if phrase in normalized:
            phrases.append((phrase, 5))
            for alias in aliases:
                weighted_terms[alias] = max(weighted_terms.get(alias, 0), 3)

    tokens = _tokenize(normalized)
    for token in tokens:
        if token in STOP_WORDS:
            continue
        weighted_terms[token] = max(weighted_terms.get(token, 0), 4)
        for alias in TERM_ALIASES.get(token, []):
            weighted_terms[alias] = max(weighted_terms.get(alias, 0), 2)

    return {
        "normalized": normalized,
        "phrases": phrases,
        "terms": weighted_terms,
        "tokens": tokens,
        "raw_topic_terms": {
            token
            for token in tokens
            if token not in STOP_WORDS
            and token not in UI_HINT_TERMS
            and token not in EDIT_HINT_TERMS
            and token not in {"action", "actions", "menu", "item", "items", "component", "react"}
        },
        "topic_terms": {
            _normalize_term(token)
            for token in tokens
            if token not in STOP_WORDS
            and token not in UI_HINT_TERMS
            and token not in EDIT_HINT_TERMS
            and token not in {"action", "actions", "menu", "item", "items", "component", "react"}
        },
    }


def _node_text(node: dict) -> dict:
    file_id = _str(node.get("id"))
    exports = _list(node.get("exports"))
    summary = _str(node.get("summary"))
    domain = _str(node.get("domain"))
    basename = file_id.split("/")[-1]
    id_tokens = set(_tokenize(file_id))
    basename_tokens = set(_tokenize(basename))
    export_tokens = set()
    for export in exports:
        export_tokens.update(_tokenize(export))
    summary_tokens = set(_tokenize(summary))
    return {
        "id": file_id.lower(),
        "exports": [e.lower() for e in exports],
        "summary": summary.lower(),
        "domain": domain.lower(),
        "basename": basename.lower(),
        "id_tokens": id_tokens,
        "basename_tokens": basename_tokens,
        "export_tokens": export_tokens,
        "summary_tokens": summary_tokens,
    }


def _contains_any(text: str, terms: set) -> bool:
    return any(term in text for term in terms)


def _node_feature_terms(node: dict) -> set:
    file_id = _str(node.get("id"))
    exports = _list(node.get("exports"))
    summary = _str(node.get("summary"))

    terms = set()
    for token in _tokenize(file_id):
        norm = _normalize_term(token)
        if norm not in GENERIC_PATH_TOKENS and norm not in STOP_WORDS and len(norm) > 2:
            terms.add(norm)
    for export in exports[:5]:
        for token in _tokenize(export):
            norm = _normalize_term(token)
            if norm not in GENERIC_PATH_TOKENS and norm not in STOP_WORDS and len(norm) > 2:
                terms.add(norm)
    for token in _tokenize(summary):
        norm = _normalize_term(token)
        if norm not in GENERIC_PATH_TOKENS and norm not in STOP_WORDS and len(norm) > 2:
            terms.add(norm)
    return terms


def _node_raw_terms(node: dict) -> set:
    file_id = _str(node.get("id"))
    exports = _list(node.get("exports"))
    summary = _str(node.get("summary"))

    terms = set()
    for token in _tokenize(file_id):
        if token not in GENERIC_PATH_TOKENS and token not in STOP_WORDS and len(token) > 2:
            terms.add(token)
    for export in exports[:5]:
        for token in _tokenize(export):
            if token not in GENERIC_PATH_TOKENS and token not in STOP_WORDS and len(token) > 2:
                terms.add(token)
    for token in _tokenize(summary):
        if token not in GENERIC_PATH_TOKENS and token not in STOP_WORDS and len(token) > 2:
            terms.add(token)
    return terms


def _score_node(node: dict, query_info: dict, patterns: dict = None, prefer_source: bool = False) -> tuple:
    text = _node_text(node)
    score = 0
    reasons = []
    matched_terms = set()
    query_token_set = set(query_info["tokens"])
    raw_topic_terms = set(query_info.get("raw_topic_terms", set()))
    topic_terms = set(query_info.get("topic_terms", set()))
    node_terms = _node_feature_terms(node)
    node_raw_terms = _node_raw_terms(node)

    for phrase, weight in query_info["phrases"]:
        if phrase in text["id"]:
            score += weight + 4
            reasons.append(f"path matches '{phrase}'")
        elif phrase in text["summary"]:
            score += weight + 2
            reasons.append(f"summary matches '{phrase}'")

    for term, weight in query_info["terms"].items():
        if term in text["basename_tokens"]:
            score += weight + 5
            reasons.append(f"filename matches '{term}'")
            matched_terms.add(term)
            continue
        if term in text["id_tokens"]:
            score += weight + 3
            reasons.append(f"path matches '{term}'")
            matched_terms.add(term)
        if term in text["export_tokens"]:
            score += weight + 4
            reasons.append(f"export matches '{term}'")
            matched_terms.add(term)
        if term in text["summary_tokens"]:
            score += weight + 1
            reasons.append(f"summary matches '{term}'")
            matched_terms.add(term)
        if term == text["domain"]:
            score += weight + 1
            reasons.append(f"domain matches '{term}'")
            matched_terms.add(term)

    if len(matched_terms) > 1:
        score += len(matched_terms) * 2

    action_menu_hit = _contains_any(text["id"], ACTION_MENU_HINT_TERMS) or any(
        _contains_any(export, ACTION_MENU_HINT_TERMS) for export in text["exports"]
    )
    view_hit = _contains_any(text["id"], {"page", "view", "widget", "tab"}) or any(
        _contains_any(export, {"page", "view", "widget", "tab"}) for export in text["exports"]
    )
    if action_menu_hit and "/components/" in text["id"] and any(term in UI_HINT_TERMS for term in query_info["terms"]):
        score += 3
        reasons.append("UI action surface")
    if topic_terms:
        raw_overlap = raw_topic_terms & node_raw_terms
        overlap = topic_terms & node_terms
        if raw_overlap:
            score += 18 + (6 * len(raw_overlap))
            reasons.append(f"exact topic matches: {', '.join(sorted(raw_overlap)[:3])}")
        if overlap:
            score += 14 + (5 * len(overlap))
            reasons.append(f"topic matches: {', '.join(sorted(overlap)[:3])}")
            if "/components/" in text["id"] or "/pages/" in text["id"]:
                score += 8
                reasons.append("topic-aligned source area")
        elif node_terms:
            score -= min(18, 6 + (2 * len(topic_terms)))
            reasons.append("topic mismatch penalty")

    if view_hit and topic_terms and ("/components/" in text["id"] or "/pages/" in text["id"]):
        score += 4
        reasons.append("matches requested UI surface")
    if any(marker in text["id"] for marker in ("tablerow", "/row", "listtab")) and action_menu_hit:
        score += 6
        reasons.append("row/list component with action surface")

    pattern = patterns.get(node["id"]) if patterns else None
    if pattern == "component" and any(term in UI_HINT_TERMS for term in query_info["terms"]):
        score += 3
        reasons.append("pattern suggests UI component")
    elif pattern == "entry-point" and any(term in {"page", "view"} for term in query_info["terms"]):
        score += 2
        reasons.append("pattern suggests page entry point")
    elif pattern == "test":
        score -= 8
        reasons.append("test artifact penalty")

    if query_token_set & EDIT_HINT_TERMS:
        if text["id"].startswith("e2e-tests/") or any(
            marker in text["id"] for marker in (".test.", "/locators/", "/pageobjects/", "/pageelements/")
        ):
            score -= 40
            reasons.append("penalized non-source test helper for edit intent")
        elif "/components/" in text["id"] or "/pages/" in text["id"]:
            score += 5
            reasons.append("preferred editable source file")
        if text["id"].endswith(".tsx"):
            score += 5
            reasons.append("tsx source file")
        if any(text["id"].endswith(suffix) for suffix in ("/index.ts", "/index.tsx", "/types.ts", "/enums.ts", ".graphql")):
            score -= 30
            reasons.append("penalized unlikely edit target")
    elif prefer_source:
        if text["id"].startswith("e2e-tests/") or any(
            marker in text["id"] for marker in (".test.", "/locators/", "/pageobjects/", "/pageelements/")
        ):
            score -= 20
            reasons.append("penalized support artifact")
        if "/components/" in text["id"] or "/pages/" in text["id"]:
            score += 5
            reasons.append("preferred source file")
        if text["id"].endswith(".tsx"):
            score += 4
            reasons.append("tsx source file")
        if any(text["id"].endswith(suffix) for suffix in ("/index.ts", "/index.tsx", "/types.ts", "/enums.ts", ".graphql")):
            score -= 15
            reasons.append("penalized indirect target")

    deduped_reasons = []
    seen = set()
    for reason in reasons:
        if reason not in seen:
            deduped_reasons.append(reason)
            seen.add(reason)

    return score, deduped_reasons


def _search_nodes(data: dict, query: str, domain: str = None, patterns: dict = None, prefer_source: bool = False) -> list:
    query_info = _query_terms(query)
    nodes = _list(data.get("nodes"))
    if domain:
        nodes = [n for n in nodes if n.get("domain") == domain]

    results = []
    for node in nodes:
        score, reasons = _score_node(node, query_info, patterns=patterns, prefer_source=prefer_source)
        if score > 0:
            results.append((score, node, reasons))

    results.sort(key=lambda item: (-item[0], item[1]["id"]))
    return results


def _intent_family_key(path: str) -> str:
    """Group sibling UI files that differ only by a narrow variant suffix."""
    parts = path.split("/")
    basename = parts[-1]
    stem = re.sub(r"\.[^.]+$", "", basename)
    stem = re.sub(r"(Invites|Requests|Invite|Request|Members|Member)$", "", stem)
    return "/".join(parts[:-1] + [stem])


def _family_label(path: str) -> str:
    basename = path.split("/")[-1]
    stem = re.sub(r"\.[^.]+$", "", basename)
    if stem.endswith("Invites") or stem.endswith("Invite"):
        return "invite actions"
    if stem.endswith("Requests") or stem.endswith("Request"):
        return "request actions"
    return "member actions"


def _group_intent_results(results: list, max_items: int = 10) -> list:
    grouped = []
    used = set()

    for idx, item in enumerate(results[:max_items]):
        if idx in used:
            continue

        score, node, reasons = item
        family_key = _intent_family_key(node["id"])
        siblings = [(idx, item)]

        for other_idx, other_item in enumerate(results[:max_items], start=0):
            if other_idx == idx or other_idx in used:
                continue
            other_score, other_node, _ = other_item
            if _intent_family_key(other_node["id"]) != family_key:
                continue
            if abs(other_score - score) <= 8:
                siblings.append((other_idx, other_item))

        for member_idx, _ in siblings:
            used.add(member_idx)

        siblings.sort(key=lambda pair: (-pair[1][0], pair[1][1]["id"]))
        grouped.append({
            "primary": siblings[0][1],
            "siblings": [entry for _, entry in siblings],
        })

    return grouped


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
    depth = node.get('depth', -1)
    depth_str = str(depth) if depth >= 0 else 'unreachable' if node.get('reachable') is False else 'unknown'
    role = node.get('architectural_role', '')

    print(f"\n   Summary:   {node['summary']}")
    print(f"   Depth:     {depth_str}")
    if role:
        print(f"   Role:      {role}")

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
    results = _search_nodes(data, term, domain=domain, patterns=patterns)

    if not results:
        domain_str = f" in domain '{domain}'" if domain else ""
        print(f"No results for '{term}'{domain_str}.")
        return

    domain_str = f" in domain '{domain}'" if domain else ""
    print(f"\n🔍  Search: '{term}'{domain_str}  ({len(results)} results)\n")

    # Group by pattern if patterns are available
    if not patterns:
        # Fallback: no pattern grouping
        for score, node, reasons in results[:20]:
            exports_preview = ", ".join(_list(node.get("exports"))[:3])
            print(f"   [{score}★] {node['id']}  [{node['domain']}]")
            if reasons:
                print(f"         why: {', '.join(reasons[:2])}")
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

    for score, node, reasons in results:
        pattern = patterns.get(node["id"], "other")
        if pattern in results_by_pattern:
            results_by_pattern[pattern].append((score, node, reasons))
        else:
            results_by_pattern["other"].append((score, node, reasons))

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
        for score, node, reasons in results_by_pattern[pattern]:
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
            if reasons:
                print(f"         why: {', '.join(reasons[:2])}")
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


def cmd_architecture(data: dict):
    """Show the architecture layers and critical paths derived from entry point tracing."""
    layers = data.get("architecture_layers", {})
    paths  = data.get("critical_paths", [])

    layer_meta = [
        ("routers",      "🔀", "Route handlers, controllers, pages"),
        ("middleware",   "🔗", "Middleware, guards, interceptors"),
        ("services",     "⚙️ ", "Business logic, services"),
        ("repositories", "🗄️ ", "Repositories, models, data access"),
    ]

    print(f"\n🏗️   Architecture Layers\n")
    any_layers = False
    for key, icon, desc in layer_meta:
        files = layers.get(key, [])
        if not files:
            continue
        any_layers = True
        print(f"  {icon}  {key.title()} ({len(files)})  —  {desc}")
        for f in files[:10]:
            print(f"       {f}")
        if len(files) > 10:
            print(f"       ... and {len(files) - 10} more")
        print()

    if not any_layers:
        print("  No architecture layers detected.")
        print("  (Files may not follow standard directory/naming conventions.)")

    if paths:
        print(f"\n📍  Critical Paths  ({len(paths)} entry point{'s' if len(paths) > 1 else ''})\n")
        for p in paths:
            print(f"  Entry: {p['entry']}")
            for key, icon, _ in layer_meta:
                items = p.get(key, [])
                if items:
                    print(f"    {icon}  {key}: {', '.join(items[:5])}")
                    if len(items) > 5:
                        print(f"         ... and {len(items) - 5} more")
            print()


def cmd_depth(data: dict, depth: int):
    """Show all files at a given depth from entry points."""
    nodes = _list(data.get("nodes"))
    matched = [n for n in nodes if n.get("depth") == depth]

    if not matched:
        # Give a useful hint about what depths exist
        depths_present = sorted({n.get("depth", -1) for n in nodes if n.get("depth", -1) >= 0})
        if depths_present:
            print(f"No files at depth {depth}. Depths present: {depths_present[:20]}")
        else:
            print("No depth data in map. Re-run the indexer to generate depth information.")
        return

    print(f"\n📏  Depth {depth}  ({len(matched)} files)\n")
    for n in sorted(matched, key=lambda x: x["id"]):
        role = f"  [{n['architectural_role']}]" if n.get("architectural_role") else ""
        print(f"   {n['id']}{role}")


def cmd_role(data: dict, role: str):
    """Show all files tagged with a given architectural role."""
    valid = {"router", "service", "repository", "middleware"}
    if role not in valid:
        print(f"Unknown role '{role}'. Valid roles: {', '.join(sorted(valid))}")
        return

    nodes = _list(data.get("nodes"))
    matched = [n for n in nodes if n.get("architectural_role") == role]

    if not matched:
        print(f"No files tagged with role '{role}'.")
        print("Files get tagged based on directory names (routes/, services/, etc.)")
        print("and file suffixes (.service.ts, .repository.ts, etc.).")
        return

    print(f"\n🏷️   Role: {role}  ({len(matched)} files)\n")
    for n in sorted(matched, key=lambda x: x.get("depth", 999)):
        depth = n.get("depth", -1)
        depth_str = f"d{depth}" if depth >= 0 else "  ?"
        print(f"   [{depth_str}]  {n['id']}  [{n.get('domain', '')}]")


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


def cmd_paths(data: dict, domain: str):
    """Return unique top-level directories for a domain — for scoped grep."""
    clusters = data.get("clusters", {})
    files = clusters.get(domain, [])
    if not files:
        available = list(clusters.keys())
        print(f"No domain '{domain}' found. Available: {', '.join(sorted(available))}")
        return

    # Collect unique directories at depth 1-3 to keep grep scope tight
    dirs = set()
    for f in files:
        parts = f.split('/')
        dirs.add('/'.join(parts[:min(3, len(parts) - 1)]) if len(parts) > 1 else '.')

    # Deduplicate — remove dirs that are subdirectories of another in the set
    sorted_dirs = sorted(dirs)
    pruned = []
    for d in sorted_dirs:
        if not any(d.startswith(p + '/') for p in pruned):
            pruned.append(d)

    print(f"\n📁  Grep paths for domain '{domain}':\n")
    for d in pruned:
        print(f"   {d}")
    print(f"\n   Usage: grep -r \"<term>\" {' '.join(pruned)}")


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
    domain_scores = {}
    for score, node, _ in _search_nodes(data, search_term):
        domain = node.get("domain", "unknown")
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
    
    print(f"\n   Try: python3 query.py --intent '{search_term}'")
    print(f"   Or:  python3 query.py --search '{search_term}' --domain {sorted_domains[0][0]}")


def cmd_intent(data: dict, query: str, domain: str = None, patterns: dict = None):
    """Return the most likely files for a natural-language lookup task."""
    results = _search_nodes(data, query, domain=domain, patterns=patterns, prefer_source=True)

    if not results:
        domain_str = f" in domain '{domain}'" if domain else ""
        print(f"No likely files found for '{query}'{domain_str}.")
        return

    domain_str = f" in domain '{domain}'" if domain else ""
    print(f"\n🎯  Intent: '{query}'{domain_str}\n")

    groups = _group_intent_results(results, max_items=10)

    for rank, group in enumerate(groups, 1):
        score, node, reasons = group["primary"]
        exports_preview = ", ".join(_list(node.get("exports"))[:3])
        print(f"   {rank}. [{score}★] {node['id']}  [{node['domain']}]")
        if reasons:
            print(f"      why: {', '.join(reasons[:3])}")
        if exports_preview:
            print(f"      exports: {exports_preview}")
        if len(group["siblings"]) > 1:
            variants = ", ".join(
                f"{entry[1]['id']} ({_family_label(entry[1]['id'])})"
                for entry in group["siblings"][1:]
            )
            print(f"      related: {variants}")

    top_group = groups[0]
    best = top_group["primary"][1]["id"]
    if len(top_group["siblings"]) > 1:
        labels = ", ".join(
            f"{entry[1]['id']} ({_family_label(entry[1]['id'])})"
            for entry in top_group["siblings"]
        )
        print(f"\n   Clarify if needed: top matches are sibling variants: {labels}")
    print(f"   Best next step: python3 query.py --file {best}")


def main():
    parser = argparse.ArgumentParser(
        description="Query your coldstart_map.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--map", default="coldstart_map.json", help="Path to coldstart_map.json")
    parser.add_argument("--domain", help="List files in a domain cluster")
    parser.add_argument("--paths", help="Return grep-ready directory paths for a domain")
    parser.add_argument("--file", help="Show metadata for a specific file")
    parser.add_argument("--hot", "--hot-nodes", action="store_true", help="Show hot nodes (most imported)")
    parser.add_argument("--cycles", action="store_true", help="Show circular dependencies")
    parser.add_argument("--search", help="Search file IDs, exports, and summaries")
    parser.add_argument("--intent", help="Find likely files for a natural-language task")
    parser.add_argument("--suggest-domain", help="Suggest domains based on search term")
    parser.add_argument("--impact", help="Show files affected if this file changes")
    parser.add_argument("--gql", action="store_true", help="Show all GraphQL definitions")
    parser.add_argument("--hooks", action="store_true", help="List files that export React hooks")
    parser.add_argument("--patterns", action="store_true", help="Show code pattern distribution")
    parser.add_argument("--summary", action="store_true", help="Print codebase summary")
    parser.add_argument("--architecture", action="store_true", help="Show architecture layers and critical paths")
    parser.add_argument("--depth", type=int, help="Show files at a given depth from entry points")
    parser.add_argument("--role", choices=["router", "service", "repository", "middleware"],
                        help="Filter files by architectural role")
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
    if args.search or args.patterns or args.intent:
        patterns = load_patterns(str(map_path))

    # --summary first: wins over other flags if multiple are passed
    if args.summary:
        cmd_summary(data)
    elif args.architecture:
        cmd_architecture(data)
    elif args.depth is not None:
        cmd_depth(data, args.depth)
    elif args.role:
        cmd_role(data, args.role)
    elif args.paths:
        cmd_paths(data, args.paths)
    elif args.suggest_domain:
        cmd_suggest_domain(data, args.suggest_domain)
    elif args.intent:
        cmd_intent(data, args.intent, domain=args.domain, patterns=patterns)
    elif args.patterns:
        cmd_patterns(data)
    elif args.search:
        cmd_search(data, args.search, domain=args.domain, patterns=patterns)
    elif args.domain:
        cmd_domain(data, args.domain)
    elif args.file:
        cmd_file(data, args.file)
    elif args.hot:
        cmd_hot(data)
    elif args.cycles:
        cmd_cycles(data)
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
