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

Before searching or opening files, use the coldstart MCP tools to orient
yourself. This saves tokens and avoids broad, speculative file reads.

## Lookup order

1. \`get-overview\` — Use like a search engine, not a codebase summarizer.
   Pass \`domain_filter\` with specific code tokens from your task to find relevant files fast.
   Do NOT call this for general exploration — it only does targeted keyword lookup.
   Bare words are AND logic: "auth payment" = must match auth AND payment.
   Bracket groups are OR synonyms: "[auth|login|jwt] payment" = any auth synonym AND payment.
   Pluralization is automatic: "grouphub" also matches "grouphubs".
   Results include source flags: F=filename, P=path, S=symbol, I=import.
   Call iteratively — adjust tokens based on what comes back:
   - Zero results → try synonyms, shorter tokens, or a different spelling
   - Diagnostic warning → tokens are too common; add a second specific token
   - Too many results → add another concept token to narrow down
   Set include_import_only=true only if the file you need imports the concept but doesn't own it.

2. \`get-structure\` — Check a file's shape WITHOUT reading it.
   Returns exports, imports, symbols (with line numbers for TS/JS/Java/Ruby), line count, and token estimate.
   Only read the full file if get-structure confirms it's relevant.
   Check \`tokenEstimate\` before reading large files.

3. \`trace-deps\` — Follow dependency chains WITHOUT opening files.
   \`direction="imports"\`: what does this file depend on?
   \`direction="importers"\`: what depends on this file?
   Use \`depth=2\` or \`depth=3\` for transitive chains.

4. \`trace-impact\` — Understand blast radius of symbol changes.
   Shows every function/class that directly or transitively depends on a given symbol.
   Use before refactoring to scope affected code without reading all dependent files.

## Preferred patterns

\`\`\`
# Starting a task with a known concept (e.g. "fix the auth flow")
get-overview(domain_filter="[auth|login|jwt]") → get-structure → read file (only if needed)

# Understanding how a component connects to the rest of the codebase
get-structure → trace-deps → read file (only if needed)

# Before refactoring a function or class
trace-impact(symbol="MyFunction") → trace-deps(direction="importers") → targeted edits
\`\`\`

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
