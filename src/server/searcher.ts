/**
 * Recall-engine resolution — which ripgrep runs `find`'s per-term scans.
 *
 * Preference order (fastest first):
 *   1. COLDSTART_RG env var — explicit user override, never second-guessed
 *   2. `rg` on PATH — the user's own ripgrep
 *   3. bundled @vscode/ripgrep — regular dependency; npm installs the matching
 *      platform subpackage (no install scripts, registry-only)
 *   4. editor-app copies — VS Code and Cursor ship a ripgrep inside the app
 *      bundle; the Claude Code binary IS ripgrep when invoked with argv0=rg
 *
 * Every candidate must answer `--version` with "ripgrep ..." before it wins.
 * Probing costs a few process spawns and the answer is machine-global, so the
 * winner is persisted in ~/.coldstart/searcher.json; later runs revalidate it
 * with a stat instead of re-probing. A scan-time spawn failure calls
 * invalidateRg() to drop the record and re-resolve once.
 *
 * No ripgrep at all → find.ts falls back to git grep → grep → pure-Node scan.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export interface RgBinary {
  bin: string;
  /** Set for multiplexed binaries (the claude CLI) that dispatch on argv[0]. */
  argv0?: string;
}

const CACHE_FILE = join(homedir(), '.coldstart', 'searcher.json');

let _rg: RgBinary | null | undefined; // undefined = not yet resolved this process

/** True iff `bin` runs and identifies itself as ripgrep. */
function isRipgrep(bin: string, argv0?: string): boolean {
  try {
    const out = execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
      ...(argv0 ? { argv0 } : {}),
    });
    return out.startsWith('ripgrep');
  } catch {
    return false;
  }
}

function bundledRgPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const { rgPath } = require('@vscode/ripgrep') as { rgPath: string };
    return existsSync(rgPath) ? rgPath : null; // platform subpackage may be absent (--omit=optional)
  } catch {
    return null;
  }
}

/** Known in-app ripgrep locations, cheapest checks first. */
function appCandidates(): RgBinary[] {
  const out: RgBinary[] = [];
  const sub = join('node_modules', '@vscode', 'ripgrep', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  if (process.platform === 'darwin') {
    out.push({ bin: join('/Applications/Visual Studio Code.app/Contents/Resources/app', sub) });
    out.push({ bin: join('/Applications/Cursor.app/Contents/Resources/app', sub) });
  } else if (process.platform === 'linux') {
    out.push({ bin: join('/usr/share/code/resources/app', sub) });
    out.push({ bin: join('/usr/share/cursor/resources/app', sub) });
  } else if (process.platform === 'win32' && process.env['LOCALAPPDATA']) {
    out.push({ bin: join(process.env['LOCALAPPDATA'], 'Programs', 'Microsoft VS Code', 'resources', 'app', sub) });
    out.push({ bin: join(process.env['LOCALAPPDATA'], 'Programs', 'cursor', 'resources', 'app', sub) });
  }
  // The Claude Code CLI embeds ripgrep and dispatches on argv[0].
  out.push({ bin: 'claude', argv0: 'rg' });
  return out;
}

function loadCached(): RgBinary | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as { bin?: string; argv0?: string };
    if (!raw.bin) return null;
    // Absolute paths get a cheap stat; bare names (PATH rg, claude) can only be
    // trusted — a scan-time spawn failure invalidates them.
    if (isAbsolute(raw.bin) && !existsSync(raw.bin)) return null;
    return { bin: raw.bin, ...(raw.argv0 ? { argv0: raw.argv0 } : {}) };
  } catch {
    return null;
  }
}

function saveCached(rg: RgBinary): void {
  try {
    mkdirSync(join(homedir(), '.coldstart'), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(rg));
  } catch {
    /* cache is an optimization; resolution still works without it */
  }
}

function probeAll(): RgBinary | null {
  const env = process.env['COLDSTART_RG'];
  if (env && isRipgrep(env)) return { bin: env };
  if (isRipgrep('rg')) return { bin: 'rg' };
  const bundled = bundledRgPath();
  if (bundled && isRipgrep(bundled)) return { bin: bundled };
  for (const cand of appCandidates()) {
    if (isAbsolute(cand.bin) && !existsSync(cand.bin)) continue;
    if (isRipgrep(cand.bin, cand.argv0)) return cand;
  }
  return null;
}

/**
 * Resolve the ripgrep to use, memoized per process and persisted across runs
 * (CLI readers are a fresh process per call — without the disk record every
 * `find` would pay the probe spawns). Returns null when no ripgrep exists.
 */
export function resolveRg(): RgBinary | null {
  if (_rg !== undefined) return _rg;
  const env = process.env['COLDSTART_RG'];
  if (env) {
    _rg = isRipgrep(env) ? { bin: env } : probeAll(); // env always wins over the disk record
    if (_rg) saveCached(_rg);
    return _rg;
  }
  const cached = loadCached();
  if (cached) return (_rg = cached);
  _rg = probeAll();
  if (_rg) saveCached(_rg);
  return _rg;
}

/** Drop the memo + disk record after a scan-time spawn failure, forcing a fresh probe. */
export function invalidateRg(): void {
  _rg = undefined;
  try {
    rmSync(CACHE_FILE, { force: true });
  } catch {
    /* ignore */
  }
}
