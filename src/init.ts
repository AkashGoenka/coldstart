/**
 * coldstart init — wire coldstart into a project.
 *
 * Model: a single `coldstart.md` lives at the repo root and carries ALL the
 * agent-facing guidance. Clients pull it in by reference, so future wording
 * changes touch only coldstart.md, never the client's own rules file.
 *
 *   - Claude Code  → ensure CLAUDE.md exists and imports it via `@coldstart.md`.
 *   - Any other app → write coldstart.md only; the user wires it as rules/
 *     instructions/skill however their app prefers (and, for no-shell clients,
 *     adds the MCP server entry we print).
 *
 * The content of coldstart.md depends on how the client invokes coldstart:
 *   - `cli` flavor → the agent runs `coldstart find` / `coldstart gs` (shell).
 *   - `mcp` flavor → the agent calls the `find` / `gs` MCP tools (no shell).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const DIVIDER = '─'.repeat(60);
const IMPORT_LINE = '@coldstart.md';

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// coldstart.md content — one doc, two invocation flavors
// ---------------------------------------------------------------------------

export function coldstartMd(mode: 'cli' | 'mcp'): string {
  const cli = mode === 'cli';
  const find = cli ? '`coldstart find <terms...>`' : 'the `find` tool';
  const gs = cli ? '`coldstart gs <file>`' : 'the `gs` tool';
  const invocation = cli
    ? 'Two local, instant shell commands'
    : 'Two local, instant MCP tools';
  const flags = cli
    ? `## Load-bearing flags
- \`find --path GLOB\` — scope to a glob (\`--path 'app/**/*.py'\`); \`,\` to combine, \`!\` to exclude.
- \`find --tests\` — include test files (excluded by default).
- \`gs --match TERM\` — on a god-file, filter to one area (\`--match tile\`); \`a|b\` = OR, \`/regex/\` = regex.
- \`gs --view symbols|imports|importers|callers\` — one section instead of the full page.
- \`gs <file> --symbol a,b\` — deliver named method bodies inline + caller/callee pointers.

## Batch independent lookups in one call
\`coldstart find auth; coldstart find 'session cookie'; coldstart gs src/auth/service.ts\`
`
    : `## Load-bearing params
- \`find\` \`path\` — scope to a glob (\`app/**/*.py\`); \`,\` to combine, \`!\` to exclude.
- \`gs\` \`match\` — on a god-file, filter to one area (\`tile\`); \`a|b\` = OR, \`/regex/\` = regex.
- \`gs\` \`view\` (symbols|imports|importers|callers) — one section instead of the full page.
- \`gs\` \`symbol\` (\`a,b\`) — deliver named method bodies inline + caller/callee pointers.
`;

  return `# coldstart — fast codebase navigation

${invocation} that answer "where does this live?" and "what is this file?" without a model call. Reach for them BEFORE Grep/Glob/Read when orienting in a codebase or locating code.

- ${find} — locate the files relevant to a concept. Pass EVERY salient identifier (symbol, domain noun, the rare token you half-remember), not one keyword. Ranks files by how many of your terms they cover.
- ${gs} — drill into one file: its symbols (with line ranges), who imports it, who calls each symbol, and name-related neighbors. This is the answer to "who uses this file / who calls this symbol" — not grep.

## Flow
1. ${find} on a concept → pick the best path.
2. ${gs} on that file → shape + who uses it.
3. \`Read\` only for the implementation inside a method body.

${flags}
## Reading the output
- Top files are marked \`▸ <path>  [covered/total]\` — how many of your query terms they cover — with a \`Role:\` line (which terms each defines/imports) and an inline preview of the body lines where your terms cluster. Often enough to answer WITHOUT a Read.
- A \`Wired:\` line shows relations: \`uses\`/\`used by\` = import edges; \`near\` = a name-reference relation the import graph can't see (the files share a rare identifier/string token — migration↔model, config-by-name, cross-language). Treat wired files as one unit: if one is worth opening, the others usually belong in your answer too.
- "no indexed file contains any of [...]" = those identifiers aren't in the repo. Don't grep spelling variants.
- \`gs\` Importers with \`match\` lists every file whose content references the term — exhaustive, so a subsystem absent from it does NOT use the symbol. Don't grep to re-verify.

## Stop rule
Ran \`gs\` on 5+ files for one question → you're enumerating. Go back to \`find\` with a sharper \`path\` scope or a different concept token.

## When NOT to use it
- A literal string/phrase/regex inside file bodies → Grep.
- Reading an implementation → Read, after \`gs\` gives the shape.
`;
}

// ---------------------------------------------------------------------------
// Stable install resolution + MCP entry (printed for no-shell / other clients)
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to a stable install of coldstart. If
 * `~/.coldstart/versions/<version>/` already has it, reuse it; otherwise copy
 * the running install there. `init` always runs from a complete on-disk
 * install (npx cache, global, or local devDep), so the source tree exists.
 */
function getOrInstallStableVersion(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (!home) throw new Error('Could not determine HOME directory');

  const pkgPath = path.resolve(path.dirname(path.dirname(__filename)), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  const version = pkg.version;
  if (!version) throw new Error('Could not determine version from package.json');

  const versionDir = path.join(home, '.coldstart', 'versions', version);
  const entryPath = path.join(versionDir, 'node_modules', 'coldstart-mcp', 'dist', 'index.js');
  if (fs.existsSync(entryPath)) return entryPath;

  const running = fs.realpathSync(process.argv[1]);
  const sourceNm = path.resolve(running, '..', '..', '..');
  if (!fs.existsSync(path.join(sourceNm, 'coldstart-mcp', 'package.json'))) {
    throw new Error(`Cannot locate the running coldstart-mcp install from ${running}.`);
  }

  out(`Copying coldstart-mcp@${version} to ~/.coldstart/versions/${version}/ …`);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.cpSync(sourceNm, path.join(versionDir, 'node_modules'), { recursive: true });
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Copy completed but entry file not found at ${entryPath}`);
  }
  return entryPath;
}

function mcpServerEntry(cwd: string): { command: string; args: string[] } {
  const entryPath = getOrInstallStableVersion();
  return { command: 'node', args: [entryPath, '--root', cwd] };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function writeColdstartMd(cwd: string, mode: 'cli' | 'mcp'): 'created' | 'updated' {
  const filePath = path.join(cwd, 'coldstart.md');
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, coldstartMd(mode));
  return existed ? 'updated' : 'created';
}

/** Ensure CLAUDE.md exists and imports coldstart.md via `@coldstart.md`. */
export function wireClaudeImport(cwd: string): 'created' | 'added' | 'present' {
  const filePath = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Project guidance\n\n${IMPORT_LINE}\n`);
    return 'created';
  }
  const existing = fs.readFileSync(filePath, 'utf8');
  if (existing.includes(IMPORT_LINE)) return 'present';
  const sep = existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(filePath, `${sep}\n${IMPORT_LINE}\n`);
  return 'added';
}

// ---------------------------------------------------------------------------
// Setup routines
// ---------------------------------------------------------------------------

function setupClaude(cwd: string): void {
  const mdResult = writeColdstartMd(cwd, 'cli');
  const importResult = wireClaudeImport(cwd);
  out(`  coldstart.md  — ${mdResult} (CLI flavor)`);
  out(`  CLAUDE.md     — ${importResult === 'present' ? 'already imports @coldstart.md' : `${importResult} @coldstart.md import`}`);
}

function setupOther(cwd: string): void {
  const mdResult = writeColdstartMd(cwd, 'mcp');
  out(`  coldstart.md  — ${mdResult} (MCP flavor)`);
  out('');
  out('  Wire it into your client:');
  out('  1. Add coldstart.md to your client\'s rules / instructions / skill');
  out('     (whatever your app uses — point it at this file or paste its contents).');
  out('  2. Add the MCP server entry to your client\'s MCP config:');
  out('');
  let entry: { command: string; args: string[] };
  try {
    entry = mcpServerEntry(cwd);
  } catch (e) {
    out(`     (could not resolve a stable install path: ${e})`);
    return;
  }
  out('       ' + JSON.stringify({ mcpServers: { coldstart: entry } }, null, 2).split('\n').join('\n       '));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runInit(): Promise<void> {
  const cwd = process.cwd();
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const hasClaude = fs.existsSync(path.join(home, '.claude'));

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (question: string): Promise<string> => {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase();
  };

  out('');
  out('coldstart init');
  out(DIVIDER);
  out('');

  let claude: boolean;
  if (hasClaude) {
    out('Detected: Claude Code');
    out('');
    out('Will write:');
    out('  coldstart.md  — agent guidance (CLI flavor)');
    out('  CLAUDE.md     — import `@coldstart.md` (create if missing, append if present)');
    out('');
    const answer = await ask('Set up for Claude Code? [Y/n] ');
    claude = answer === '' || answer === 'y';
  } else {
    out('Which client are you wiring coldstart into?');
    out('');
    out('  1  Claude Code  (coldstart.md + @coldstart.md import in CLAUDE.md)');
    out('  2  Other app    (coldstart.md only — you wire it as rules + add the MCP server)');
    out('');
    const answer = await ask('Choose [1/2]: ');
    claude = answer === '1';
  }

  rl.close();
  out('');

  if (claude) setupClaude(cwd);
  else setupOther(cwd);

  out('');
  out(DIVIDER);
  out('Done. Full docs: https://github.com/AkashGoenka/coldstart');
  out('');
}
