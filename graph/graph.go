package graph

import "sync"

// Edge represents a directed dependency between two files.
type Edge struct {
	From string `json:"from"` // Importer file ID
	To   string `json:"to"`   // Imported file ID
	Type string `json:"type"` // "imports" | "re-exports"
}

// Graph is a directed dependency graph of the codebase.
type Graph struct {
	mu       sync.RWMutex
	Nodes    map[string]*Node `json:"nodes"`
	Edges    []Edge           `json:"edges"`
	adjOut   map[string][]string // file -> files it imports
	adjIn    map[string][]string // file -> files that import it
}

// New creates an empty Graph.
func New() *Graph {
	return &Graph{
		Nodes:  make(map[string]*Node),
		adjOut: make(map[string][]string),
		adjIn:  make(map[string][]string),
	}
}

// AddNode inserts or replaces a node (thread-safe).
func (g *Graph) AddNode(n *Node) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.Nodes[n.ID] = n
}

// AddEdge inserts a directed edge from -> to (thread-safe).
func (g *Graph) AddEdge(from, to, edgeType string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	e := Edge{From: from, To: to, Type: edgeType}
	g.Edges = append(g.Edges, e)
	g.adjOut[from] = append(g.adjOut[from], to)
	g.adjIn[to] = append(g.adjIn[to], from)
}

// Dependencies returns all files that `id` directly imports.
func (g *Graph) Dependencies(id string) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.adjOut[id]
}

// Dependents returns all files that directly import `id`.
func (g *Graph) Dependents(id string) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.adjIn[id]
}

// HotNodes returns files imported by more than `threshold` other files.
// These are high-value context nodes (shared utilities, core modules).
func (g *Graph) HotNodes(threshold int) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	var hot []string
	for id, importers := range g.adjIn {
		if len(importers) >= threshold {
			hot = append(hot, id)
		}
	}
	return hot
}

// DetectCycles runs DFS to find circular dependencies.
func (g *Graph) DetectCycles() [][]string {
	g.mu.RLock()
	defer g.mu.RUnlock()

	visited := make(map[string]bool)
	recStack := make(map[string]bool)
	var cycles [][]string

	var dfs func(id string, path []string)
	dfs = func(id string, path []string) {
		visited[id] = true
		recStack[id] = true
		path = append(path, id)

		for _, neighbor := range g.adjOut[id] {
			if !visited[neighbor] {
				dfs(neighbor, path)
			} else if recStack[neighbor] {
				// Found a cycle — capture it
				cycle := make([]string, len(path))
				copy(cycle, path)
				cycles = append(cycles, cycle)
			}
		}
		recStack[id] = false
	}

	for id := range g.Nodes {
		if !visited[id] {
			dfs(id, []string{})
		}
	}
	return cycles
}

// ClusterByDomain groups node IDs by their inferred domain tag.
func (g *Graph) ClusterByDomain() map[string][]string {
	g.mu.RLock()
	defer g.mu.RUnlock()
	clusters := make(map[string][]string)
	for id, node := range g.Nodes {
		domain := node.Domain
		if domain == "" {
			domain = "misc"
		}
		clusters[domain] = append(clusters[domain], id)
	}
	return clusters
}
