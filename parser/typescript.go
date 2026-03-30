package parser

import (
	"crypto/md5"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/AkashGoenka/coldstart/graph"
)

// Compiled regexes for TS/JS parsing
var (
	// import x from '...'
	// import { x, y } from '...'
	// import * as x from '...'
	reImportFrom = regexp.MustCompile(`(?m)^import\s+(?:type\s+)?(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]`)

	// import('...')  — dynamic imports
	reImportDynamic = regexp.MustCompile(`import\(['"]([^'"]+)['"]\)`)

	// require('...')
	reRequire = regexp.MustCompile(`require\(['"]([^'"]+)['"]\)`)

	// export function/class/const/type/interface/enum Name
	reExportNamed = regexp.MustCompile(`(?m)^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)`)

	// export { x, y, z }
	reExportBraces = regexp.MustCompile(`(?m)^export\s+\{([^}]+)\}`)

	// export default identifier
	reExportDefault = regexp.MustCompile(`(?m)^export\s+default\s+(\w+)`)

	// Domain keyword sets for inference
	domainKeywords = map[string][]string{
		"auth":               {"auth", "login", "logout", "session", "jwt", "token", "password", "oauth", "permission", "role"},
		"payments":           {"payment", "billing", "invoice", "stripe", "checkout", "subscription", "price"},
		"db":                 {"database", "db", "query", "migration", "schema", "model", "repository", "prisma", "mongoose", "sequelize", "drizzle"},
		"api":                {"route", "router", "controller", "endpoint", "handler", "middleware", "request", "response"},
		"ui":                 {"component", "page", "layout", "view", "render", "hook", "style", "theme", "modal", "button"},
		"utils":              {"util", "helper", "format", "parse", "validate", "transform", "convert", "sanitize"},
		"config":             {"config", "env", "setting", "constant", "option"},
		"test":               {"test", "spec", "mock", "fixture", "factory", "__tests__"},
		"types":              {"type", "interface", "dto", "schema", "contract"},
		"queue":              {"queue", "job", "worker", "task", "scheduler", "cron", "bull", "kafka"},
		"cache":              {"cache", "redis", "memcache", "store"},
		"email":              {"email", "mail", "smtp", "sendgrid", "template", "notification"},
		"upload":             {"upload", "file", "storage", "s3", "bucket", "media"},
		"search":             {"search", "index", "elastic", "algolia", "filter", "query"},
		"graphql-operations": {"@apollo/client", "graphql-tag", "gql", "apolloclient"}`
		"graphql-schema":     {"typedefs", "type_defs", "buildschema", "makeexecutableschema", "apolloserver", "graphqlschema"},
	}
)

// Apollo-specific patterns in TS/JS files
var (
	// gql` ... ` tagged template literals — named if assigned to const
	reGQLTaggedConst = regexp.MustCompile(`(?m)const\s+(\w+)\s*=\s*gql\s*` + "`")

	// useQuery(SOME_QUERY) / useMutation(SOME_MUTATION)
	reApolloHook = regexp.MustCompile(`(?m)(useQuery|useMutation|useSubscription|useLazyQuery)\s*[<(]`)

	// ApolloClient instantiation
	reApolloClient = regexp.MustCompile(`new\s+ApolloClient\s*\(`)

	// @apollo/client imports
	reApolloImport = regexp.MustCompile(`from\s+['"]@apollo/client['"]`)
)

// ParseFile parses a single TS/JS file and returns a populated Node.
func ParseFile(absPath, relPath string) (*graph.Node, error) {
	raw, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	content := string(raw)

	node := &graph.Node{
		ID:            relPath,
		Language:      detectLanguage(relPath),
		LineCount:     strings.Count(content, "\n") + 1,
		TokenEstimate: len(content) / 4,
		Hash:          fmt.Sprintf("%x", md5.Sum(raw)),
		IsEntryPoint:  isEntryPoint(relPath),
	}

	node.Imports = extractImports(content)
	node.Exports = extractExports(content)
	node.Domain = inferDomain(relPath, content)

	// Detect Apollo/GQL usage in TS/JS files and append to summary
	apolloAnnotations := extractApolloMeta(content)
	node.Summary = buildSummary(node)
	if len(apolloAnnotations) > 0 {
		node.Summary += " " + strings.Join(apolloAnnotations, ". ") + "."
	}

	return node, nil
}

// extractImports pulls all import specifiers (static, dynamic, require).
func extractImports(content string) []string {
	seen := make(map[string]bool)
	var imports []string

	add := func(matches [][]string) {
		for _, m := range matches {
			if len(m) > 1 {
				spec := m[1]
				if !seen[spec] {
					seen[spec] = true
					imports = append(imports, spec)
				}
			}
		}
	}

	add(reImportFrom.FindAllStringSubmatch(content, -1))
	add(reImportDynamic.FindAllStringSubmatch(content, -1))
	add(reRequire.FindAllStringSubmatch(content, -1))

	return imports
}

// extractExports pulls all exported symbol names.
func extractExports(content string) []string {
	seen := make(map[string]bool)
	var exports []string

	add := func(name string) {
		name = strings.TrimSpace(name)
		if name != "" && !seen[name] {
			seen[name] = true
			exports = append(exports, name)
		}
	}

	for _, m := range reExportNamed.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			add(m[1])
		}
	}

	for _, m := range reExportBraces.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			for _, sym := range strings.Split(m[1], ",") {
				// handle "original as alias" — take alias
				parts := strings.Fields(strings.TrimSpace(sym))
				if len(parts) == 3 && parts[1] == "as" {
					add(parts[2])
				} else if len(parts) == 1 {
					add(parts[0])
				}
			}
		}
	}

	for _, m := range reExportDefault.FindAllStringSubmatch(content, -1) {
		if len(m) > 1 {
			add("default:" + m[1])
		}
	}

	return exports
}

// inferDomain guesses the domain of a file from its path + content keywords.
func inferDomain(relPath, content string) string {
	combined := strings.ToLower(relPath + " " + content[:min(len(content), 2000)])

	bestDomain := ""
	bestScore := 0

	for domain, keywords := range domainKeywords {
		score := 0
		for _, kw := range keywords {
			if strings.Contains(combined, kw) {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			bestDomain = domain
		}
	}

	if bestScore == 0 {
		return "misc"
	}
	return bestDomain
}

// buildSummary produces a compact 1-line description from node metadata.
func buildSummary(n *graph.Node) string {
	parts := []string{}

	if n.IsEntryPoint {
		parts = append(parts, "Entry point.")
	}

	if len(n.Exports) > 0 {
		shown := n.Exports
		if len(shown) > 5 {
			shown = shown[:5]
		}
		parts = append(parts, fmt.Sprintf("Exports: %s.", strings.Join(shown, ", ")))
	}

	if len(n.Imports) > 0 {
		parts = append(parts, fmt.Sprintf("%d import(s).", len(n.Imports)))
	}

	parts = append(parts, fmt.Sprintf("Domain: %s.", n.Domain))
	parts = append(parts, fmt.Sprintf("~%d tokens.", n.TokenEstimate))

	return strings.Join(parts, " ")
}

// extractApolloMeta detects Apollo/GQL usage patterns within TS/JS files.
// Returns a list of annotations added to the summary.
func extractApolloMeta(content string) []string {
	var annotations []string

	// Detect inline gql`` tagged template literals
	if matches := reGQLTaggedConst.FindAllStringSubmatch(content, -1); len(matches) > 0 {
		names := make([]string, 0, len(matches))
		for _, m := range matches {
			if len(m) > 1 {
				names = append(names, m[1])
			}
		}
		annotations = append(annotations, fmt.Sprintf("gql-tags: %s", strings.Join(names, ", ")))
	}

	// Detect Apollo hooks
	hooks := reApolloHook.FindAllStringSubmatch(content, -1)
	if len(hooks) > 0 {
		seen := make(map[string]bool)
		var hookNames []string
		for _, m := range hooks {
			if len(m) > 1 && !seen[m[1]] {
				seen[m[1]] = true
				hookNames = append(hookNames, m[1])
			}
		}
		annotations = append(annotations, fmt.Sprintf("apollo-hooks: %s", strings.Join(hookNames, ", ")))
	}

	// Detect ApolloClient instantiation
	if reApolloClient.MatchString(content) {
		annotations = append(annotations, "apollo-client-setup")
	}

	return annotations
}

// detectLanguage maps file extension to language name.
func detectLanguage(path string) string {
	switch filepath.Ext(path) {
	case ".ts", ".tsx":
		return "typescript"
	case ".js", ".jsx":
		return "javascript"
	case ".mjs", ".cjs":
		return "javascript"
	default:
		return "unknown"
	}
}

// isEntryPoint returns true for common entry point file names.
func isEntryPoint(relPath string) bool {
	base := strings.ToLower(filepath.Base(relPath))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	entryNames := map[string]bool{
		"index": true, "main": true, "app": true,
		"server": true, "entry": true, "start": true,
	}
	return entryNames[base]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
