package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"coldstart/indexer"
	"coldstart/output"
)

const banner = `
 ██████╗ ██████╗ ██╗     ██████╗     ███████╗████████╗ █████╗ ██████╗ ████████╗
██╔════╝██╔═══██╗██║     ██╔══██╗    ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝
██║     ██║   ██║██║     ██║  ██║    ███████╗   ██║   ███████║██████╔╝   ██║   
██║     ██║   ██║██║     ██║  ██║    ╚════██║   ██║   ██╔══██║██╔══██╗   ██║   
╚██████╗╚██████╔╝███████╗██████╔╝    ███████║   ██║   ██║  ██║██║  ██║   ██║   
 ╚═════╝ ╚═════╝ ╚══════╝╚═════╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   
              eliminate the AI agent cold start problem   v1.0.0
`

func main() {
	// ── Flags ─────────────────────────────────────────────────────────────────
	rootDir    := flag.String("root", ".", "Root directory of your codebase")
	outputPath := flag.String("output", "coldstart_map.json", "Output file path")
	excludeArg := flag.String("exclude", "", "Comma-separated extra dirs to exclude (e.g. 'dist,build')")
	workers    := flag.Int("workers", 16, "Number of parallel workers")
	quiet      := flag.Bool("quiet", false, "Suppress banner and progress output")
	flag.Parse()

	if !*quiet {
		fmt.Print(banner)
	}

	// ── Config ────────────────────────────────────────────────────────────────
	cfg := indexer.DefaultConfig(*rootDir)
	cfg.Workers = *workers

	// Merge extra exclusions
	if *excludeArg != "" {
		for _, dir := range strings.Split(*excludeArg, ",") {
			dir = strings.TrimSpace(dir)
			if dir != "" {
				cfg.Exclude[dir] = true
			}
		}
	}

	// ── Validate root ─────────────────────────────────────────────────────────
	if _, err := os.Stat(*rootDir); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "❌  Root directory not found: %s\n", *rootDir)
		os.Exit(1)
	}

	// ── Run indexer ───────────────────────────────────────────────────────────
	if !*quiet {
		fmt.Printf("📂  Scanning:  %s\n", *rootDir)
		fmt.Printf("⚙️   Workers:   %d\n\n", cfg.Workers)
	}

	start := time.Now()
	g, stats, err := indexer.Run(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌  Indexing failed: %v\n", err)
		os.Exit(1)
	}
	elapsed := time.Since(start)

	// ── Write output ──────────────────────────────────────────────────────────
	if err := output.Write(g, stats, *rootDir, *outputPath); err != nil {
		fmt.Fprintf(os.Stderr, "❌  Failed to write output: %v\n", err)
		os.Exit(1)
	}

	// ── Summary ───────────────────────────────────────────────────────────────
	if !*quiet {
		cycles := g.DetectCycles()
		fmt.Printf("✅  Done in %s\n\n", elapsed.Round(time.Millisecond))
		fmt.Printf("   Files scanned:   %d\n", stats.FilesScanned)
		fmt.Printf("   Files indexed:   %d\n", stats.FilesIndexed)
		fmt.Printf("   Files skipped:   %d\n", stats.FilesSkipped)
		fmt.Printf("   Edges resolved:  %d\n", stats.EdgesResolved)
		fmt.Printf("   Total tokens:    ~%d\n", stats.TotalTokens)
		fmt.Printf("   Circular deps:   %d\n", len(cycles))
		fmt.Printf("\n📄  Map written to: %s\n", *outputPath)

		if len(cycles) > 0 {
			fmt.Printf("\n⚠️   Circular dependencies detected:\n")
			for i, cycle := range cycles {
				if i >= 5 {
					fmt.Printf("     ... and %d more\n", len(cycles)-5)
					break
				}
				fmt.Printf("     %s\n", strings.Join(cycle, " → "))
			}
		}

		hotNodes := g.HotNodes(5)
		if len(hotNodes) > 0 {
			fmt.Printf("\n🔥  Hot nodes (imported by 5+ files):\n")
			for i, id := range hotNodes {
				if i >= 5 {
					fmt.Printf("     ... and %d more (see coldstart_map.json)\n", len(hotNodes)-5)
					break
				}
				deps := g.Dependents(id)
				fmt.Printf("     %s (%d dependents)\n", id, len(deps))
			}
		}
	}
}
