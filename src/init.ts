/**
 * coldstart-mcp init — Prints MCP config and agent rules for manual setup.
 *
 * Usage: npx coldstart-mcp init
 *
 * Paste the MCP config into your IDE's MCP configuration file.
 * Paste the agent rules into your IDE's instructions/rules file.
 * Full docs: https://github.com/AkashGoenka/coldstart
 */

const DIVIDER = '─'.repeat(60);

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

export function runInit(): void {
  const cwd = process.cwd();

  out('');
  out('coldstart-mcp init');
  out(DIVIDER);
  out('');
  out('1. MCP SERVER CONFIG');
  out('   Add this to your IDE\'s MCP configuration:');
  out('');

  const mcpConfig = {
    mcpServers: {
      coldstart: {
        command: 'npx',
        args: ['-y', 'coldstart-mcp', '--root', cwd],
      },
    },
  };
  process.stdout.write(JSON.stringify(mcpConfig, null, 2) + '\n');

  out('');
  out(DIVIDER);
  out('');
  out('2. AGENT RULES');
  out('   Paste this into your IDE\'s instructions/rules file:');
  out('');
  out(DIVIDER);

  const rules = `# Codebase navigation — use coldstart MCP tools

Before searching or opening files, use the coldstart MCP tools to orient yourself.
This saves tokens and avoids broad, speculative file reads.

## The 4 tools

1. **\`get-overview\`** — Find files by domain/token keywords (filename, path, exports, imports).
   - Pass \`domain_filter\` with specific code tokens from your task.
   - Bare words = AND logic: "auth payment" matches files with both tokens.
   - Bracket groups = OR synonyms: "[auth|login|jwt] payment" = any auth term AND payment.
   - Pluralization is automatic: "workspace" also matches "workspaces".
   - Results show \`path\` and \`sources\` (which tokens matched).
   - Call iteratively: if truncated, either call \`get-structure\` on a visible file or narrow the query.
   - \`max_results\` defaults to 15 (increase sparingly; large result sets waste context).
   - \`include_tests\` (default false) — set true if searching for test files.

2. **\`get-structure\`** — Inspect a single file's shape WITHOUT reading it.
   - Returns: exports, imports, symbols with line numbers, language, line count, token estimate.
   - Fast way to decide if a file is relevant before opening it.

3. **\`trace-deps\`** — Follow dependency chains WITHOUT opening files.
   - \`direction="imports"\`: what does this file depend on?
   - \`direction="importers"\`: what depends on this file?
   - Use \`depth=2\` or \`depth=3\` for transitive chains.

4. **\`trace-impact\`** — Understand blast radius of symbol changes.
   - Shows every function/class that directly or transitively depends on a symbol.
   - Use before refactoring to scope affected code without reading dependent files.

## Workflow examples

**Starting a task with a known concept (e.g. "fix the auth flow"):**
1. \`get-overview(domain_filter="[auth|login|jwt]")\`
2. \`get-structure\` on a promising file
3. Read the file only if confirmed relevant

**Understanding how a component connects:**
1. \`get-structure(file_path="path/to/file.ts")\`
2. \`trace-deps(file_path="path/to/file.ts", direction="importers")\`
3. Read dependent files if needed

**Before refactoring a function or class:**
1. \`trace-impact(symbol="MyFunction")\`
2. Review affected symbols and dependencies
3. Make targeted edits

## When to fall back to grep/rg

Use grep only when coldstart tools don't answer the question:
- Searching for a specific string literal inside file contents
- Looking for all call sites of a function by exact name across the whole repo
- Searching inside comments or string values

In all other cases, prefer coldstart tools first.
`;

  process.stdout.write(rules);

  out(DIVIDER);
  out('');
  out('Full setup docs: https://github.com/AkashGoenka/coldstart');
  out('');
}
