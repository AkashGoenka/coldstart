package graph

// Node represents a single file in the codebase dependency graph.
type Node struct {
	ID            string   `json:"id"`             // Relative file path, e.g. "src/auth/middleware.ts"
	Language      string   `json:"language"`       // "typescript" | "javascript" | "graphql"
	Summary       string   `json:"summary"`        // Auto-generated 1-line description
	Exports       []string `json:"exports"`        // Exported symbols (functions, classes, types, consts)
	Imports       []string `json:"imports"`        // Raw import specifiers found in the file
	Domain        string   `json:"domain"`         // Inferred domain tag e.g. "auth", "payments", "graphql"
	IsEntryPoint  bool     `json:"is_entry_point"` // true if this is an index/main/app file
	LineCount     int      `json:"line_count"`
	TokenEstimate int      `json:"token_estimate"` // Rough token count (chars / 4)
	Hash          string   `json:"hash"`           // MD5 of file content, for change detection

	// React hook exports — only populated when project has React and file exports use* functions
	HookNames []string `json:"hook_names,omitempty"`

	// GraphQL-specific fields — only populated for .graphql / .gql files
	GQL *GQLMeta `json:"gql,omitempty"`
}

// GQLMeta holds GraphQL-specific metadata extracted from .graphql / .gql files.
type GQLMeta struct {
	TypesDefined  []string `json:"types_defined"`  // type Foo { ... }
	Queries       []string `json:"queries"`         // query GetFoo { ... }
	Mutations     []string `json:"mutations"`       // mutation CreateFoo { ... }
	Subscriptions []string `json:"subscriptions"`   // subscription OnFoo { ... }
	Fragments     []string `json:"fragments"`       // fragment FooFields on Foo { ... }
	Inputs        []string `json:"inputs"`          // input CreateFooInput { ... }
	Enums         []string `json:"enums"`           // enum FooStatus { ... }
	Interfaces    []string `json:"interfaces"`      // interface Node { ... }
	Unions        []string `json:"unions"`          // union SearchResult = Foo | Bar
	IsSchema      bool     `json:"is_schema"`       // true if file defines Query/Mutation root types
}
