package output

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"time"

	"coldstart/graph"
	"coldstart/indexer"
)

// MapOutput is the final JSON structure written to coldstart_map.json.
type MapOutput struct {
	Meta     Meta                  `json:"meta"`
	Nodes    []*graph.Node         `json:"nodes"`
	Edges    []graph.Edge          `json:"edges"`
	Clusters map[string][]string   `json:"clusters"`
	HotNodes []HotNode             `json:"hot_nodes"`
	Cycles   [][]string            `json:"cycles,omitempty"`
	Stats    *indexer.Stats        `json:"stats"`
}

// Meta holds indexer run metadata.
type Meta struct {
	GeneratedAt   string `json:"generated_at"`
	RootDir       string `json:"root_dir"`
	TotalFiles    int    `json:"total_files"`
	TotalEdges    int    `json:"total_edges"`
	TotalTokens   int64  `json:"total_tokens"`
	IndexerVersion string `json:"indexer_version"`
}

// HotNode is a node with high fan-in (many dependents).
type HotNode struct {
	ID         string `json:"id"`
	Dependents int    `json:"dependents"`
	Domain     string `json:"domain"`
}

const IndexerVersion = "1.0.0"
const HotNodeThreshold = 5  // files imported by 5+ others are "hot"
const DefaultOutputFile = "coldstart_map.json"

// Write serializes the graph to the given output path.
func Write(g *graph.Graph, stats *indexer.Stats, rootDir, outputPath string) error {
	// Sort nodes by ID for deterministic output (easier to diff in git)
	nodes := make([]*graph.Node, 0, len(g.Nodes))
	for _, n := range g.Nodes {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].ID < nodes[j].ID
	})

	// Build hot nodes list with dependents count
	hotIDs := g.HotNodes(HotNodeThreshold)
	hotNodes := make([]HotNode, 0, len(hotIDs))
	for _, id := range hotIDs {
		deps := g.Dependents(id)
		node := g.Nodes[id]
		domain := ""
		if node != nil {
			domain = node.Domain
		}
		hotNodes = append(hotNodes, HotNode{
			ID:         id,
			Dependents: len(deps),
			Domain:     domain,
		})
	}
	sort.Slice(hotNodes, func(i, j int) bool {
		return hotNodes[i].Dependents > hotNodes[j].Dependents
	})

	out := MapOutput{
		Meta: Meta{
			GeneratedAt:    time.Now().UTC().Format(time.RFC3339),
			RootDir:        rootDir,
			TotalFiles:     len(nodes),
			TotalEdges:     len(g.Edges),
			TotalTokens:    stats.TotalTokens,
			IndexerVersion: IndexerVersion,
		},
		Nodes:    nodes,
		Edges:    g.Edges,
		Clusters: g.ClusterByDomain(),
		HotNodes: hotNodes,
		Cycles:   g.DetectCycles(),
		Stats:    stats,
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal output: %w", err)
	}

	if err := os.WriteFile(outputPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write output file: %w", err)
	}

	return nil
}
