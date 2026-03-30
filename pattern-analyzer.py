#!/usr/bin/env python3
"""
pattern-analyzer.py — Enhance coldstart_map.json with semantic code patterns.

This tool analyzes the coldstart_map.json file and adds pattern metadata to each node,
classifying files by their role in the codebase architecture:

- configuration: UI options, configs, mappings, settings, feature flags
- type-definition: Types, interfaces, constants, enums, type guards
- implementation: Business logic, algorithms, handlers, services
- component: React/Vue components, pages, layouts
- utility: Helpers, adapters, services, formatters
- test: Test suites, mocks, fixtures
- entry-point: Index files, main entry points, re-exports

Usage:
    python3 pattern-analyzer.py --map coldstart_map.json
    python3 pattern-analyzer.py --map coldstart_map.json --output enhanced_map.json
"""

import json
import argparse
import sys
from pathlib import Path


def detect_pattern(node: dict) -> str:
    """
    Detect the semantic pattern of a file based on:
    - File name and path
    - Exports (types, consts, functions)
    - Domain
    - Summary
    """
    file_id = node.get("id", "").lower()
    exports = node.get("exports") or []
    domain = node.get("domain", "")
    summary = (node.get("summary") or "").lower()
    is_entry_point = node.get("is_entry_point", False)

    # Test files
    if any(x in file_id for x in [".test.", ".spec.", "__tests__", "mock/"]):
        return "test"

    # Entry points
    if is_entry_point or any(x in file_id for x in ["index.ts", "index.js"]):
        # But if it only re-exports a few things and has minimal logic, it's entry-point
        # If it has substantial logic/constants, it's implementation
        if len(exports or []) > 0 and len(exports or []) <= 10:
            return "entry-point"

    # Type/interface/enum/const definitions
    # Heuristics: file name contains "type", "interface", "enum", "constant", ".d.ts"
    # or exports are mostly PascalCase (types) or SCREAMING_CASE (constants)
    if any(x in file_id for x in [".d.ts", "types/", "interface", "enum", "constant"]):
        return "type-definition"

    # Check if exports are mostly types/interfaces/constants (heuristic: PascalCase or SCREAMING_CASE)
    if exports:
        type_like = sum(1 for e in exports if e[0].isupper() or (e.isupper() and "_" in e))
        if type_like / len(exports) > 0.7:  # >70% type-like exports
            return "type-definition"

    # Configuration files
    if any(x in file_id for x in ["config", "option", "constant", ".config."]):
        # But distinguish from type definitions
        # Config files often have specific naming patterns and exports like XxxxConfig, XxxxOptions
        if "option" in file_id or "config" in file_id:
            return "configuration"

    # Component files
    if any(
        x in file_id
        for x in [
            ".component.ts",
            ".component.js",
            ".tsx",
            "components/",
            "pages/",
            "layout/",
            "view/",
        ]
    ):
        if ".tsx" in file_id or ".jsx" in file_id or "component" in file_id:
            return "component"

    # Utility/helper files
    if any(x in file_id for x in ["util", "helper", "service", "adapter", "handler"]):
        return "utility"

    # Implementation by default (handlers, services, business logic)
    # Check if domain suggests this is configuration or type-heavy
    if domain in ["config", "types"]:
        # But if the file is in these domains and not explicitly type-like, it's configuration
        if domain == "config":
            return "configuration"
        return "type-definition"

    return "implementation"


def analyze(map_path: str) -> dict:
    """Load map, add pattern metadata to each node, return enhanced map."""
    with open(map_path) as f:
        data = json.load(f)

    nodes = data.get("nodes") or []
    for node in nodes:
        pattern = detect_pattern(node)
        node["pattern"] = pattern

    return data


def main():
    parser = argparse.ArgumentParser(
        description="Enhance coldstart_map.json with semantic code patterns"
    )
    parser.add_argument(
        "--map",
        default="coldstart_map.json",
        help="Path to coldstart_map.json (default: coldstart_map.json)",
    )
    parser.add_argument(
        "--output",
        help="Output file path (default: overwrites input map)",
    )

    args = parser.parse_args()

    map_path = Path(args.map)
    if not map_path.is_file():
        # Try common locations
        for alt in [
            Path("tools/coldstart/coldstart_map.json"),
            Path(__file__).resolve().parent / "coldstart_map.json",
        ]:
            if alt.is_file():
                map_path = alt
                break
        if not map_path.is_file():
            print(f"❌  Map file not found: {args.map}")
            sys.exit(1)

    print(f"📂  Analyzing:  {map_path}")

    data = analyze(str(map_path))

    output_path = args.output or args.map
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    # Count patterns
    pattern_counts = {}
    for node in data.get("nodes") or []:
        pattern = node.get("pattern", "unknown")
        pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1

    print(f"✅  Done. {len(data.get('nodes', []))} nodes enhanced.\n")
    print("Pattern distribution:")
    for pattern in sorted(pattern_counts.keys()):
        count = pattern_counts[pattern]
        bar = "█" * min(count // 10, 30)
        print(f"   {pattern:20} {count:5d}  {bar}")

    print(f"\n📄  Map written to: {output_path}")


if __name__ == "__main__":
    main()
