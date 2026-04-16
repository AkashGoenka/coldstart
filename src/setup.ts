/**
 * coldstart-mcp setup — Interactive wizard for configuring coldstart
 * with your project and IDE of choice.
 *
 * Usage: coldstart-mcp setup [--root <path>]
 */
import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { EXTENSION_TO_LANGUAGE } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type IDE = 'claude-code' | 'cursor' | 'vscode' | 'windsurf';

interface IDEOption {
  id: IDE;
  name: string;
  detected: boolean;
}

// ---------------------------------------------------------------------------
// Terminal helpers (no external deps)
// ---------------------------------------------------------------------------
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function out(msg: string): void {
  process.stderr.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// Line-buffered stdin reader (works reliably with both TTY and piped input)
// ---------------------------------------------------------------------------
const lineBuffer: string[] = [];
let lineResolver: ((line: string) => void) | null = null;
let stdinDone = false;

function initInput(): void {
  stdin.setEncoding('utf-8');
  let partial = '';
  stdin.on('data', (chunk: string) => {
    partial += chunk;
    const lines = partial.split('\n');
    partial = lines.pop()!;
    for (const line of lines) {
      if (lineResolver) {
        const cb = lineResolver;
        lineResolver = null;
        cb(line);
      } else {
        lineBuffer.push(line);
      }
    }
  });
  stdin.on('end', () => {
    stdinDone = true;
    if (partial) {
      if (lineResolver) {
        const cb = lineResolver;
        lineResolver = null;
        cb(partial);
      } else {
        lineBuffer.push(partial);
      }
    }
    if (lineResolver) {
      const cb = lineResolver;
      lineResolver = null;
      cb('');
    }
  });
  stdin.resume();
}

function closeInput(): void {
  stdin.pause();
  stdin.removeAllListeners('data');
  stdin.removeAllListeners('end');
}

async function getLine(): Promise<string> {
  if (lineBuffer.length > 0) return lineBuffer.shift()!;
  if (stdinDone) return '';
  return new Promise<string>((resolve) => { lineResolver = resolve; });
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  if (stdinDone && lineBuffer.length === 0) return defaultValue || '';
  const suffix = defaultValue ? dim(` (${defaultValue})`) : '';
  stdout.write(`  ${question}${suffix}: `);
  const answer = await getLine();
  return answer.trim() || defaultValue || '';
}

async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(`${question} [${hint}]`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

// ---------------------------------------------------------------------------
// IDE detection
// ---------------------------------------------------------------------------
async function detectIDEs(projectDir: string): Promise<IDEOption[]> {
  const checks: Array<{ id: IDE; name: string; markers: string[] }> = [
    { id: 'claude-code', name: 'Claude Code', markers: ['CLAUDE.md', '.mcp.json'] },
    { id: 'cursor', name: 'Cursor', markers: ['.cursor', '.cursorrules'] },
    { id: 'windsurf', name: 'Windsurf', markers: ['.windsurf', '.windsurfrules'] },
    { id: 'vscode', name: 'VS Code / GitHub Copilot', markers: ['.vscode'] },
  ];

  const results: IDEOption[] = [];
  for (const check of checks) {
    let detected = false;
    for (const marker of check.markers) {
      try {
        await access(join(projectDir, marker));
        detected = true;
        break;
      } catch { /* not found */ }
    }
    results.push({ id: check.id, name: check.name, detected });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Quick project scan (shallow, fast)
// ---------------------------------------------------------------------------
async function quickScan(
  projectDir: string,
): Promise<{ fileCount: number; languages: Map<string, number> }> {
  const languages = new Map<string, number>();
  let fileCount = 0;
  const skipDirs = new Set([
    'node_modules', 'dist', 'build', 'vendor', 'target', '__pycache__',
    '.git', '.next', '.nuxt', 'out', 'coverage', '.gradle', 'Pods',
  ]);

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (skipDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        if (dotIdx === -1) continue;
        const ext = entry.name.slice(dotIdx);
        const lang = EXTENSION_TO_LANGUAGE[ext];
        if (lang) {
          fileCount++;
          languages.set(lang, (languages.get(lang) ?? 0) + 1);
        }
      }
    }
  }

  await scan(projectDir, 0);
  return { fileCount, languages };
}

// ---------------------------------------------------------------------------
// Agent rules content (shared across IDEs)
// ---------------------------------------------------------------------------
function getAgentRules(): string {
  return `# Codebase navigation — use coldstart MCP tools

Before searching or opening files, use the coldstart MCP tools to orient
yourself. This saves tokens and avoids broad, speculative file reads.

## Lookup order

1. \`get-overview\` — CALL THIS FIRST to understand project structure.
   Returns domains, architectural roles, and inter-domain dependencies.
   Use \`domain_filter\` to zoom into one area (e.g. "auth", "payments").

2. \`get-structure\` — Check a file's shape WITHOUT reading it.
   Returns exports, imports, symbols, line count, and token estimate.
   Only read the full file if get-structure confirms it's relevant.
   Check \`tokenEstimate\` before reading large files.

3. \`trace-deps\` — Follow dependency chains WITHOUT opening files.
   \`direction="imports"\`: what does this file depend on?
   \`direction="importers"\`: what depends on this file?
   Use \`depth=2\` or \`depth=3\` for transitive chains.

4. \`trace-impact\` — Understand blast radius of symbol changes.
   Shows every function/class that depends on a given symbol.
   Use before refactoring to scope affected code.

## Preferred patterns

\`\`\`
# Starting a new task in an unfamiliar area
get-overview → get-structure → read file (only if needed)

# Understanding how a component connects to the rest of the codebase
get-overview → trace-deps → read file (only if needed)

# Before refactoring a function or class
trace-impact → trace-deps (direction="importers") → targeted edits
\`\`\`

## When to fall back to grep/rg

Use grep only when coldstart tools don't answer the question:
- Searching for a specific string literal inside file contents
- Looking for call sites of a function by name across the whole repo
- Need up-to-the-second accuracy (index refreshes on git changes)

In all other cases, prefer coldstart tools first.
`;
}

// ---------------------------------------------------------------------------
// MCP config generators
// ---------------------------------------------------------------------------
function getMcpServerEntry(rootDir: string): object {
  return {
    command: 'npx',
    args: ['-y', 'coldstart-mcp', '--root', rootDir],
  };
}

function getClaudeCodeMcpConfig(rootDir: string): object {
  return {
    mcpServers: {
      coldstart: getMcpServerEntry(rootDir),
    },
  };
}

function getCursorMcpConfig(rootDir: string): object {
  return {
    mcpServers: {
      coldstart: getMcpServerEntry(rootDir),
    },
  };
}

function getVSCodeMcpConfig(rootDir: string): object {
  return {
    servers: {
      coldstart: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'coldstart-mcp', '--root', rootDir],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// File operations — merge-safe JSON config writing
// ---------------------------------------------------------------------------
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function mergeAndWriteMcpConfig(
  configPath: string,
  newConfig: Record<string, unknown>,
): Promise<'created' | 'merged'> {
  const existing = await readJsonFile(configPath);

  if (existing) {
    // Merge: add/update coldstart entry, preserve everything else
    for (const [topKey, topVal] of Object.entries(newConfig)) {
      if (typeof topVal === 'object' && topVal !== null && !Array.isArray(topVal)) {
        const existingSection = (existing[topKey] as Record<string, unknown>) ?? {};
        existing[topKey] = { ...existingSection, ...(topVal as Record<string, unknown>) };
      } else {
        existing[topKey] = topVal;
      }
    }
    await writeFile(configPath, JSON.stringify(existing, null, 2) + '\n');
    return 'merged';
  }

  // Ensure parent directory exists
  const parentDir = configPath.slice(0, configPath.lastIndexOf('/'));
  await mkdir(parentDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(newConfig, null, 2) + '\n');
  return 'created';
}

async function writeRulesFile(
  filePath: string,
  content: string,
): Promise<'created' | 'appended' | 'exists'> {
  if (await fileExists(filePath)) {
    const existing = await readFile(filePath, 'utf-8');
    if (existing.includes('coldstart')) {
      return 'exists'; // Already has coldstart rules
    }
    // Append with separator
    const separator = '\n\n---\n\n';
    await writeFile(filePath, existing.trimEnd() + separator + content);
    return 'appended';
  }
  await writeFile(filePath, content);
  return 'created';
}

// ---------------------------------------------------------------------------
// Per-IDE setup handlers
// ---------------------------------------------------------------------------
async function setupClaudeCode(projectDir: string, rootDir: string): Promise<void> {
  out(`\n  ${bold('Claude Code')}`);

  // MCP config → .mcp.json at project root
  const mcpPath = join(projectDir, '.mcp.json');
  const mcpConfig = getClaudeCodeMcpConfig(rootDir);
  const mcpResult = await mergeAndWriteMcpConfig(mcpPath, mcpConfig as Record<string, unknown>);
  if (mcpResult === 'merged') {
    out(`    ${green('+')} Merged coldstart into existing .mcp.json`);
  } else {
    out(`    ${green('+')} Created .mcp.json`);
  }

  // Agent rules → CLAUDE.md
  const rulesPath = join(projectDir, 'CLAUDE.md');
  const rulesResult = await writeRulesFile(rulesPath, getAgentRules());
  switch (rulesResult) {
    case 'created':
      out(`    ${green('+')} Created CLAUDE.md with coldstart agent rules`);
      break;
    case 'appended':
      out(`    ${green('+')} Appended coldstart rules to existing CLAUDE.md`);
      break;
    case 'exists':
      out(`    ${dim('-')} CLAUDE.md already contains coldstart rules`);
      break;
  }
}

async function setupCursor(projectDir: string, rootDir: string): Promise<void> {
  out(`\n  ${bold('Cursor')}`);

  // MCP config → .cursor/mcp.json
  const mcpPath = join(projectDir, '.cursor', 'mcp.json');
  const mcpConfig = getCursorMcpConfig(rootDir);
  const mcpResult = await mergeAndWriteMcpConfig(mcpPath, mcpConfig as Record<string, unknown>);
  if (mcpResult === 'merged') {
    out(`    ${green('+')} Merged coldstart into existing .cursor/mcp.json`);
  } else {
    out(`    ${green('+')} Created .cursor/mcp.json`);
  }

  // Agent rules → .cursorrules
  const rulesPath = join(projectDir, '.cursorrules');
  const rulesResult = await writeRulesFile(rulesPath, getAgentRules());
  switch (rulesResult) {
    case 'created':
      out(`    ${green('+')} Created .cursorrules with coldstart agent rules`);
      break;
    case 'appended':
      out(`    ${green('+')} Appended coldstart rules to existing .cursorrules`);
      break;
    case 'exists':
      out(`    ${dim('-')} .cursorrules already contains coldstart rules`);
      break;
  }
}

async function setupWindsurf(projectDir: string, rootDir: string): Promise<void> {
  out(`\n  ${bold('Windsurf')}`);

  // MCP config → .windsurf/mcp.json
  const mcpPath = join(projectDir, '.windsurf', 'mcp.json');
  const mcpConfig = getCursorMcpConfig(rootDir); // Same format as Cursor
  const mcpResult = await mergeAndWriteMcpConfig(mcpPath, mcpConfig as Record<string, unknown>);
  if (mcpResult === 'merged') {
    out(`    ${green('+')} Merged coldstart into existing .windsurf/mcp.json`);
  } else {
    out(`    ${green('+')} Created .windsurf/mcp.json`);
  }

  // Agent rules → .windsurfrules
  const rulesPath = join(projectDir, '.windsurfrules');
  const rulesResult = await writeRulesFile(rulesPath, getAgentRules());
  switch (rulesResult) {
    case 'created':
      out(`    ${green('+')} Created .windsurfrules with coldstart agent rules`);
      break;
    case 'appended':
      out(`    ${green('+')} Appended coldstart rules to existing .windsurfrules`);
      break;
    case 'exists':
      out(`    ${dim('-')} .windsurfrules already contains coldstart rules`);
      break;
  }
}

async function setupVSCode(projectDir: string, rootDir: string): Promise<void> {
  out(`\n  ${bold('VS Code / GitHub Copilot')}`);

  // MCP config → .vscode/mcp.json
  const mcpPath = join(projectDir, '.vscode', 'mcp.json');
  const mcpConfig = getVSCodeMcpConfig(rootDir);
  const mcpResult = await mergeAndWriteMcpConfig(mcpPath, mcpConfig as Record<string, unknown>);
  if (mcpResult === 'merged') {
    out(`    ${green('+')} Merged coldstart into existing .vscode/mcp.json`);
  } else {
    out(`    ${green('+')} Created .vscode/mcp.json`);
  }

  // Agent rules → .github/copilot-instructions.md
  const rulesPath = join(projectDir, '.github', 'copilot-instructions.md');
  const rulesDir = join(projectDir, '.github');
  await mkdir(rulesDir, { recursive: true });
  const rulesResult = await writeRulesFile(rulesPath, getAgentRules());
  switch (rulesResult) {
    case 'created':
      out(`    ${green('+')} Created .github/copilot-instructions.md with coldstart rules`);
      break;
    case 'appended':
      out(`    ${green('+')} Appended coldstart rules to existing copilot-instructions.md`);
      break;
    case 'exists':
      out(`    ${dim('-')} copilot-instructions.md already contains coldstart rules`);
      break;
  }
}

async function showManualInstructions(rootDir: string): Promise<void> {
  out(`\n  ${bold('Manual setup')}`);
  out('');
  out('  Add this to your IDE\'s MCP configuration:');
  out('');
  out(cyan('  ' + JSON.stringify({
    coldstart: getMcpServerEntry(rootDir),
  }, null, 2).split('\n').join('\n  ')));
  out('');
  out('  Agent rules to paste into your IDE\'s instructions file:');
  out(dim('  ─'.repeat(35)));
  const rules = getAgentRules();
  for (const line of rules.split('\n')) {
    out(`  ${dim(line)}`);
  }
  out(dim('  ─'.repeat(35)));
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------
export async function runSetup(argv: string[]): Promise<void> {
  initInput();

  try {
    // Banner
    out('');
    out(bold('  coldstart setup'));
    out(dim('  Configure coldstart-mcp for your project and IDE'));
    out('');

    // -----------------------------------------------------------------------
    // Step 1: Project path
    // -----------------------------------------------------------------------
    let rootArg: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) {
        rootArg = argv[i + 1];
      }
    }

    const cwd = process.cwd();
    const inputPath = rootArg || await ask('Project path', cwd);
    const projectDir = resolve(inputPath);

    // Validate directory exists
    try {
      await access(projectDir);
    } catch {
      out(`\n  ${yellow('Error:')} Directory not found: ${projectDir}`);
      closeInput();
      process.exit(1);
    }

    // -----------------------------------------------------------------------
    // Step 2: Quick scan
    // -----------------------------------------------------------------------
    out(dim('  Scanning project...'));
    const { fileCount, languages } = await quickScan(projectDir);

    if (fileCount === 0) {
      out(`\n  ${yellow('Warning:')} No source files found in ${projectDir}`);
      const proceed = await askYesNo('Continue anyway?', false);
      if (!proceed) {
        closeInput();
        return;
      }
    } else {
      const langSummary = [...languages.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang}: ${count}`)
        .join(', ');
      out(`  Found ${green(String(fileCount))} source files (${langSummary})`);

      // Token-saving tip for verbose languages
      const verboseLanguages = ['java', 'csharp', 'kotlin'];
      const hasVerbose = verboseLanguages.some(l => languages.has(l));
      if (hasVerbose) {
        const verboseNames = verboseLanguages.filter(l => languages.has(l)).join(', ');
        out('');
        out(`  ${cyan('Tip:')} Detected verbose language(s): ${verboseNames}`);
        out(dim('  coldstart helps agents avoid reading large files unnecessarily.'));
        out(dim('  The agent rules instruct tools to check tokenEstimate before'));
        out(dim('  reading files, which is especially valuable for verbose languages.'));
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: IDE selection
    // -----------------------------------------------------------------------
    const ideOptions = await detectIDEs(projectDir);
    out('');
    out('  Which IDE(s) do you use? (comma-separated numbers)');
    const optionLabels = ideOptions.map(
      opt => opt.detected ? `${opt.name} ${green('(detected)')}` : opt.name,
    );
    optionLabels.push('Other / paste instructions manually');
    optionLabels.forEach((label, i) => {
      out(`    ${i + 1}. ${label}`);
    });

    // Pre-fill with detected IDEs
    const detectedIdxs = ideOptions
      .map((opt, i) => opt.detected ? String(i + 1) : null)
      .filter(Boolean);
    const defaultChoice = detectedIdxs.length > 0 ? detectedIdxs.join(',') : undefined;

    const choiceStr = await ask('Enter numbers', defaultChoice);
    const selectedIdxs = choiceStr
      ? choiceStr.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(n => n >= 0 && n < optionLabels.length)
      : [];

    if (selectedIdxs.length === 0) {
      out(`\n  ${yellow('No IDEs selected.')} You can run setup again anytime.`);
      closeInput();
      return;
    }

    // -----------------------------------------------------------------------
    // Step 4: Configure each IDE
    // -----------------------------------------------------------------------
    const manualIdx = optionLabels.length - 1;

    for (const idx of selectedIdxs) {
      if (idx === manualIdx) {
        await showManualInstructions(projectDir);
        continue;
      }

      const ide = ideOptions[idx];
      switch (ide.id) {
        case 'claude-code':
          await setupClaudeCode(projectDir, projectDir);
          break;
        case 'cursor':
          await setupCursor(projectDir, projectDir);
          break;
        case 'windsurf':
          await setupWindsurf(projectDir, projectDir);
          break;
        case 'vscode':
          await setupVSCode(projectDir, projectDir);
          break;
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Multi-repo guidance
    // -----------------------------------------------------------------------
    out('');
    const hasMoreRepos = await askYesNo('Set up coldstart for another repo?', false);
    if (hasMoreRepos) {
      out('');
      out(dim('  Run this command in each repo you want to index:'));
      out(`  ${cyan('npx coldstart-mcp setup')}`);
      out('');
      out(dim('  Each repo gets its own MCP server instance and cache.'));
      out(dim('  Your IDE picks up the local config when you open the project.'));
      out('');
      out(dim('  For cross-repo access (e.g. querying a backend API repo from a'));
      out(dim('  frontend project), add multiple entries to your IDE\'s global'));
      out(dim('  MCP config, each with a different --root path.'));
    }

    // -----------------------------------------------------------------------
    // Step 6: Summary
    // -----------------------------------------------------------------------
    out('');
    out(bold('  Summary'));
    out('');
    out(`  ${green('Done!')} coldstart is configured for ${projectDir}`);
    out('');
    out('  Next steps:');
    out(`    1. Restart your IDE to pick up the new MCP config`);
    out(`    2. The agent will call ${cyan('get-overview')} before exploring files`);
    out('');
    out('  Re-indexing:');
    out(dim('    - Index auto-rebuilds when git HEAD changes (branch switch, new commit)'));
    out(dim('    - Cached for 1 hour between rebuilds'));
    out(dim(`    - Force re-index: ${cyan('npx coldstart-mcp --root . --no-cache')}`));
    out('');
    out('  Multiple repos:');
    out(dim(`    - Run ${cyan('npx coldstart-mcp setup')} in each project`));
    out(dim('    - Each repo gets independent indexing and caching'));
    out('');

    closeInput();
  } catch (err) {
    closeInput();
    throw err;
  }
}
