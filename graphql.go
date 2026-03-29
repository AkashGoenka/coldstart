package parser

import (
	"crypto/md5"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/coldstart/graph"
)

// Compiled regexes for GraphQL parsing.
// GraphQL syntax is regular enough that regex handles it cleanly —
// all definitions are top-level and follow consistent keyword patterns.
var (
	// type Foo { ... }  — but NOT input, interface, enum, union (handled separately)
	reGQLType = regexp.MustCompile(`(?m)^type\s+(\w+)(?:\s+implements\s+[\w&\s]+)?\s*\{`)

	// input CreateFooInput { ... }
	reGQLInput = regexp.MustCompile(`(?m)^input\s+(\w+)\s*\{`)

	// interface Node { ... }
	reGQLInterface = regexp.MustCompile(`(?m)^interface\s+(\w+)\s*\{`)

	// enum FooStatus { ... }
	reGQLEnum = regexp.MustCompile(`(?m)^enum\s+(\w+)\s*\{`)

	// union SearchResult = Foo | Bar
	reGQLUnion = regexp.MustCompile(`(?m)^union\s+(\w+)\s*=`)

	// query GetFoo(...) { ... }  or  query { ... }
	reGQLQuery = regexp.MustCompile(`(?m)^query\s+(\w+)`)

	// mutation CreateFoo(...) { ... }
	reGQLMutation = regexp.MustCompile(`(?m)^mutation\s+(\w+)`)

	// subscription OnFoo(...) { ... }
	reGQLSubscription = regexp.MustCompile(`(?m)^subscription\s+(\w+)`)

	// fragment FooFields on Foo { ... }
	reGQLFragment = regexp.MustCompile(`(?m)^fragment\s+(\w+)\s+on\s+\w+`)

	// extend type Foo — schema extensions
	reGQLExtend = regexp.MustCompile(`(?m)^extend\s+type\s+(\w+)`)

	// #import "./other.graphql"  — common in Apollo projects
	reGQLImport = regexp.MustCompile(`(?m)^#\s*import\s+['"]([^'"]+)['"]`)

	// scalar Foo
	reGQLScalar = regexp.MustCompile(`(?m)^scalar\s+(\w+)`)

	// schema { query: Query mutation: Mutation }
	reGQLSchemaBlock = regexp.MustCompile(`(?m)^schema\s*\{`)
)

// ParseGQLFile parses a single .graphql or .gql file and returns a populated Node.
func ParseGQLFile(absPath, relPath string) (*graph.Node, error) {
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	content := string(raw)

	// Strip comments for cleaner parsing (preserve line count first)
	lineCount := strings.Count(content, "\n") + 1
	stripped := stripGQLComments(content)

	meta := extractGQLMeta(stripped)

	node := &graph.Node{
		ID:            relPath,
		Language:      "graphql",
		LineCount:     lineCount,
		TokenEstimate: len(content) / 4,
		Hash:          fmt.Sprintf("%x", md5.Sum(raw)),
		IsEntryPoint:  false,
		Imports:       extractGQLImports(content), // use raw — imports are in comments
		GQL:           meta,
	}

	// Exports for GQL files = all named definitions (useful for cross-referencing)
	node.Exports = buildGQLExports(meta)
	node.Domain = inferGQLDomain(relPath, meta)
	node.Summary = buildGQLSummary(node)

	return node, nil
}

// extractGQLMeta pulls all GraphQL definitions from stripped content.
func extractGQLMeta(content string) *graph.GQLMeta {
	meta := &graph.GQLMeta{}

	// Types — exclude root operation types Query/Mutation/Subscription
	rootTypes := map[string]bool{"Query": true, "Mutation": true, "Subscription": true}
	for _, m := range reGQLType.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 && !rootTypes[m[1]] {
			meta.TypesDefined = append(meta.TypesDefined, m[1])
		}
		// If root types are defined here, this is a schema file
		if len(m) > 1 && rootTypes[m[1]] {
			meta.IsSchema = true
		}
	}

	// Schema block also marks this as a schema file
	if reGQLSchemaBlock.MatchString(content) {
		meta.IsSchema = true
	}

	// Extend type — adds to types defined
	for _, m := range reGQLExtend.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.TypesDefined = append(meta.TypesDefined, "extend:"+m[1])
		}
	}

	// Inputs
	for _, m := range reGQLInput.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Inputs = append(meta.Inputs, m[1])
		}
	}

	// Interfaces
	for _, m := range reGQLInterface.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Interfaces = append(meta.Interfaces, m[1])
		}
	}

	// Enums
	for _, m := range reGQLEnum.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Enums = append(meta.Enums, m[1])
		}
	}

	// Unions
	for _, m := range reGQLUnion.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Unions = append(meta.Unions, m[1])
		}
	}

	// Named queries
	for _, m := range reGQLQuery.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Queries = append(meta.Queries, m[1])
		}
	}

	// Named mutations
	for _, m := range reGQLMutation.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Mutations = append(meta.Mutations, m[1])
		}
	}

	// Named subscriptions
	for _, m := range reGQLSubscription.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Subscriptions = append(meta.Subscriptions, m[1])
		}
	}

	// Fragments
	for _, m := range reGQLFragment.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			meta.Fragments = append(meta.Fragments, m[1])
		}
	}

	return meta
}

// extractGQLImports handles Apollo-style #import directives found in comments.
func extractGQLImports(content string) []string {
	var imports []string
	seen := make(map[string]bool)
	for _, m := range reGQLImport.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 && !seen[m[1]] {
			seen[m[1]] = true
			imports = append(imports, m[1])
		}
	}
	return imports
}

// buildGQLExports flattens all named definitions into a single exports list.
// This makes GQL nodes queryable the same way TS/JS nodes are.
func buildGQLExports(meta *graph.GQLMeta) []string {
	var exports []string
	for _, t := range meta.TypesDefined {
		exports = append(exports, "type:"+t)
	}
	for _, q := range meta.Queries {
		exports = append(exports, "query:"+q)
	}
	for _, m := range meta.Mutations {
		exports = append(exports, "mutation:"+m)
	}
	for _, s := range meta.Subscriptions {
		exports = append(exports, "subscription:"+s)
	}
	for _, f := range meta.Fragments {
		exports = append(exports, "fragment:"+f)
	}
	for _, i := range meta.Inputs {
		exports = append(exports, "input:"+i)
	}
	for _, e := range meta.Enums {
		exports = append(exports, "enum:"+e)
	}
	for _, i := range meta.Interfaces {
		exports = append(exports, "interface:"+i)
	}
	for _, u := range meta.Unions {
		exports = append(exports, "union:"+u)
	}
	return exports
}

// inferGQLDomain assigns a domain to a GQL file based on path and content.
func inferGQLDomain(relPath string, meta *graph.GQLMeta) string {
	if meta.IsSchema {
		return "graphql-schema"
	}
	if len(meta.Queries) > 0 || len(meta.Mutations) > 0 || len(meta.Subscriptions) > 0 {
		return "graphql-operations"
	}
	if len(meta.Fragments) > 0 {
		return "graphql-fragments"
	}

	// Fall back to path-based inference
	lower := strings.ToLower(relPath)
	switch {
	case strings.Contains(lower, "auth"):
		return "auth"
	case strings.Contains(lower, "user"):
		return "graphql-schema"
	case strings.Contains(lower, "payment"):
		return "payments"
	default:
		return "graphql-schema"
	}
}

// buildGQLSummary produces a compact description for a GQL file.
func buildGQLSummary(n *graph.Node) string {
	if n.GQL == nil {
		return fmt.Sprintf("GraphQL file. ~%d tokens.", n.TokenEstimate)
	}
	m := n.GQL
	parts := []string{}

	if m.IsSchema {
		parts = append(parts, "Schema file.")
	}

	if len(m.TypesDefined) > 0 {
		shown := m.TypesDefined
		if len(shown) > 4 {
			shown = shown[:4]
		}
		parts = append(parts, fmt.Sprintf("Types: %s.", strings.Join(shown, ", ")))
	}

	if len(m.Queries) > 0 {
		parts = append(parts, fmt.Sprintf("Queries: %s.", strings.Join(m.Queries, ", ")))
	}

	if len(m.Mutations) > 0 {
		parts = append(parts, fmt.Sprintf("Mutations: %s.", strings.Join(m.Mutations, ", ")))
	}

	if len(m.Subscriptions) > 0 {
		parts = append(parts, fmt.Sprintf("Subscriptions: %s.", strings.Join(m.Subscriptions, ", ")))
	}

	if len(m.Fragments) > 0 {
		parts = append(parts, fmt.Sprintf("Fragments: %s.", strings.Join(m.Fragments, ", ")))
	}

	if len(m.Inputs) > 0 {
		parts = append(parts, fmt.Sprintf("Inputs: %s.", strings.Join(m.Inputs, ", ")))
	}

	if len(m.Enums) > 0 {
		parts = append(parts, fmt.Sprintf("Enums: %s.", strings.Join(m.Enums, ", ")))
	}

	if len(n.Imports) > 0 {
		parts = append(parts, fmt.Sprintf("%d import(s).", len(n.Imports)))
	}

	parts = append(parts, fmt.Sprintf("~%d tokens.", n.TokenEstimate))

	return strings.Join(parts, " ")
}

// stripGQLComments removes single-line # comments from GraphQL content.
// Preserves line structure so line numbers stay accurate.
func stripGQLComments(content string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Only strip lines that start with # (not #import directives — handled separately)
		if strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(trimmed, "#import") {
			lines[i] = ""
		}
	}
	return strings.Join(lines, "\n")
}

// extractGQLScalars pulls custom scalar definitions (used in summary for schema files).
func extractGQLScalars(content string) []string {
	var scalars []string
	for _, m := range reGQLScalar.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			scalars = append(scalars, m[1])
		}
	}
	return scalars
}
