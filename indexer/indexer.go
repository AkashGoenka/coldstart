package indexer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/AkashGoenka/coldstart/graph"
	"github.com/AkashGoenka/coldstart/parser"
)

// Config holds indexer settings.
type Config struct {
	RootDir    string
	Extensions map[string]bool // e.g. {".ts": true, ".tsx": true}
	Exclude    map[string]bool // dir names to skip e.g. {"node_modules": true}
	Workers    int             // goroutine pool size
	HasReact   bool            // true if package.json lists react as a dependency
}

// DefaultConfig returns a sensible default for TS/JS/GQL codebases.
func DefaultConfig(root string) *Config {
	return &Config{
		RootDir: root,
		Extensions: map[string]bool{
			".ts": true, ".tsx": true,
			".js": true, ".jsx": true,
			".mjs": true, ".cjs": true,
			".graphql": true, ".gql": true,
		},
		Exclude: map[string]bool{
			"node_modules": true,
			"dist":         true,
			"build":        true,
			".git":         true,
			".next":        true,
			".turbo":       true,
			"coverage":     true,
			"__pycache__":  true,
		},
		Workers: 16,
	}
}

// Stats holds indexing statistics.
type Stats struct {
	FilesScanned  int64
	FilesIndexed  int64
	FilesSkipped  int64
	TotalTokens   int64
	EdgesResolved int64
}

// Run walks the codebase concurrently and builds the dependency graph.
func Run(cfg *Config) (*graph.Graph, *Stats, error) {
	g := graph.New()
	stats := &Stats{}

	cfg.HasReact = detectReact(cfg.RootDir)

	// ── Phase 1: Collect all file paths ──────────────────────────────────────
	var filePaths []string
	err := filepath.WalkDir(cfg.RootDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable paths
		}
		if d.IsDir() {
			if cfg.Exclude[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if cfg.Extensions[ext] {
			filePaths = append(filePaths, path)
			atomic.AddInt64(&stats.FilesScanned, 1)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	// ── Phase 2: Parse files concurrently ────────────────────────────────────
	jobs := make(chan string, len(filePaths))
	for _, p := range filePaths {
		jobs <- p
	}
	close(jobs)

	var wg sync.WaitGroup
	for i := 0; i < cfg.Workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for absPath := range jobs {
				relPath, _ := filepath.Rel(cfg.RootDir, absPath)
				relPath = filepath.ToSlash(relPath) // normalize to forward slashes

				var node *graph.Node
				var err error

				ext := filepath.Ext(absPath)
				if ext == ".graphql" || ext == ".gql" {
					node, err = parser.ParseGQLFile(absPath, relPath)
				} else {
					node, err = parser.ParseFile(absPath, relPath, cfg.HasReact)
				}

				if err != nil {
					atomic.AddInt64(&stats.FilesSkipped, 1)
					continue
				}

				g.AddNode(node)
				atomic.AddInt64(&stats.FilesIndexed, 1)
				atomic.AddInt64(&stats.TotalTokens, int64(node.TokenEstimate))
			}
		}()
	}
	wg.Wait()

	// ── Phase 3: Resolve edges (import specifiers → actual file IDs) ─────────
	resolveEdges(g, cfg.RootDir, stats)

	return g, stats, nil
}

// resolveEdges converts raw import strings into graph edges.
// It resolves relative imports to actual file IDs in the graph.
func resolveEdges(g *graph.Graph, rootDir string, stats *Stats) {
	// Build a lookup set of all known node IDs for fast resolution
	knownIDs := make(map[string]bool, len(g.Nodes))
	for id := range g.Nodes {
		knownIDs[id] = true
	}

	for id, node := range g.Nodes {
		for _, imp := range node.Imports {
			// Only resolve relative imports (starting with . or ..)
			if !strings.HasPrefix(imp, ".") {
				continue
			}

			resolved := resolveRelativeImport(id, imp, knownIDs)
			if resolved != "" {
				g.AddEdge(id, resolved, "imports")
				atomic.AddInt64(&stats.EdgesResolved, 1)
			}
		}
	}
}

// detectReact reads {root}/package.json and returns true if react is listed
// as a dependency, devDependency, or peerDependency.
func detectReact(root string) bool {
	data, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return false
	}
	var pkg struct {
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
		PeerDependencies map[string]string `json:"peerDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}
	_, inDeps := pkg.Dependencies["react"]
	_, inDev := pkg.DevDependencies["react"]
	_, inPeer := pkg.PeerDependencies["react"]
	return inDeps || inDev || inPeer
}

// resolveRelativeImport tries to find the actual file ID for a relative import.
// Handles: ./foo → foo.ts, ./foo → foo/index.ts, etc.
func resolveRelativeImport(fromID, importSpec string, knownIDs map[string]bool) string {
	fromDir := filepath.ToSlash(filepath.Dir(fromID))
	base := filepath.ToSlash(filepath.Join(fromDir, importSpec))

	// Try direct extensions
	extensions := []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
	for _, ext := range extensions {
		candidate := base + ext
		if knownIDs[candidate] {
			return candidate
		}
	}

	// Try index files (e.g. ./auth → auth/index.ts)
	for _, ext := range extensions {
		candidate := base + "/index" + ext
		if knownIDs[candidate] {
			return candidate
		}
	}

	return "" // unresolved (external or missing)
}
