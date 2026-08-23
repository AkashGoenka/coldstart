/**
 * Co-change — "which files move together", derived from git history.
 *
 * The code graph answers "what does this file reference". It cannot answer
 * "what do people always edit alongside this file" when no import or call
 * connects them: a JS widget and its Python test, two sibling importers that
 * share an interface but never each other's code, a template and the view that
 * renders it by naming convention. Measured on four repos (2026-08-22), pairs
 * learned from older commits predict co-editing in the 300 most recent commits
 * the model never saw, and ADD 14 points on django / 10.2 on arches on top of
 * everything `gs`'s 1-hop graph already finds.
 *
 * It is a "these move together" claim, NOT a dependency claim — the renderer
 * must say so, or an agent reads it as an import edge.
 *
 * Same discipline as the other synthetic relations: DERIVED, never stored as
 * fact. The keeper recomputes it and drops it in a sidecar beside the cache;
 * readers read that file or degrade silently to no section at all.
 *
 * Parameters below are measured, not guessed — see
 * `~/coldstart-deep-analysis/cochange-and-reexport-2026-08-22/RESULTS.md`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getCacheDir } from '../cache/disk-cache.js';

const execFileAsync = promisify(execFile);
const GIT_BUF = 256 * 1024 * 1024;

export const CO_CHANGE_VERSION = 1;
const FILE_NAME = 'cochange.json';

/** Commits to walk. Measured: nothing improves past ~12k on any repo, and a
 *  full 15k-commit walk costs 817ms. */
export const CO_CHANGE_WINDOW = 12_000;
/** Partners STORED per file. Storage is separated from display so the cheap
 *  part (the walk) doesn't have to be redone to retune the visible cut. */
export const CO_CHANGE_K = 8;
/** Partners DISPLAYED in `gs`. Precision falls steeply with K (K=3: 22-28%,
 *  K=12: 8-15%) while recall barely moves. */
export const CO_CHANGE_SHOW = 3;
/** A single shared commit is noise. */
export const CO_CHANGE_MIN_SUPPORT = 2;
/** Commits touching more than this are sweeps (reformat, license header, mass
 *  rename) — every file in them "moves with" every other, which is not a
 *  signal. Also the quadratic guard: 30 files = 435 pairs. */
export const CO_CHANGE_MAX_COMMIT_FILES = 30;

export interface CoChangeIndex {
  v: typeof CO_CHANGE_VERSION;
  builtAt: number;
  /** HEAD the walk was taken at — the keeper re-derives when this moves. */
  head: string;
  /** Commits actually seen. Near-zero on a shallow clone (CI checkouts are
   *  shallow by default); `status` prints it so the silence is explainable. */
  commitsScanned: number;
  /** file → [partner, commits they shared][], desc, capped at CO_CHANGE_K. */
  partners: Record<string, Array<[string, number]>>;
  /** file → commits in the window that touched it. Denominator for
   *  "changed together in 14 of 17 commits", which is what makes the number
   *  readable: 14 shared out of 17 is strong, 14 out of 900 is a hub. */
  touched: Record<string, number>;
}

interface RawCommit {
  /** Paths as this commit named them (the NEW side of any rename). */
  paths: string[];
  /** `[oldPath, newPath]` for each rename in this commit. */
  renames: Array<[string, string]>;
}

/** Newest-first, matching `git log`'s own order — which the rename walk below
 *  depends on. */
function parseCommits(raw: string): RawCommit[] {
  const out: RawCommit[] = [];
  let cur: RawCommit | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('__C__')) {
      if (cur && cur.paths.length) out.push(cur);
      cur = { paths: [], renames: [] };
      continue;
    }
    if (!cur || !line.trim()) continue;
    // `status \t path` — or, for a rename, `Rnnn \t old \t new`.
    const parts = line.split('\t');
    if (parts[0].startsWith('R') && parts[1] && parts[2]) {
      cur.paths.push(parts[2]);
      cur.renames.push([parts[1], parts[2]]);
    } else if (parts[1]) {
      cur.paths.push(parts[1]);
    }
  }
  if (cur && cur.paths.length) out.push(cur);
  return out;
}

/**
 * Attribute a commit's paths to the names those files carry TODAY.
 *
 * `-M` only labels the rename commit itself; every older commit still records
 * the old path, so a file renamed a year ago looks like two unrelated files
 * with half its history each — and the older half is keyed to a path that no
 * longer exists, so it can never be shown. Since `git log` walks newest-first,
 * a rename `old → new` seen at commit i means every commit AFTER it in this
 * stream (i.e. older) that says `old` means the file now called `new`.
 *
 * Chains resolve transitively (a → b → c collapses to c), and the alias is
 * only recorded going backwards, so a path later REUSED by a different file
 * keeps its own identity in the commits above the rename.
 */
function canonicalizeRenames(commits: RawCommit[]): string[][] {
  const alias = new Map<string, string>();
  const resolve = (p: string): string => {
    let cur = p;
    for (let i = 0; i < 16 && alias.has(cur); i++) cur = alias.get(cur)!;
    return cur;
  };
  const out: string[][] = [];
  for (const c of commits) {
    out.push([...new Set(c.paths.map(resolve))]);
    for (const [from, to] of c.renames) {
      if (from !== to && !alias.has(from)) alias.set(from, resolve(to));
    }
  }
  return out;
}

/**
 * Walk git history and count which indexed files change in the same commits.
 *
 * `isIndexed` filters to files the index actually knows, applied BEFORE pairing
 * so a commit that touched 40 files but only 3 indexed ones still counts.
 * Returns null when git can't answer (no repo, no git binary) — the caller
 * writes nothing and every surface stays silent.
 */
export async function deriveCoChange(
  rootDir: string,
  isIndexed: (path: string) => boolean,
  head: string,
  window = CO_CHANGE_WINDOW,
): Promise<CoChangeIndex | null> {
  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--no-merges', '--format=__C__%H', '--name-status', '-M', '-n', String(window)],
      { cwd: rootDir, maxBuffer: GIT_BUF, windowsHide: true },
    );
    raw = stdout;
  } catch {
    return null;
  }

  const commits = canonicalizeRenames(parseCommits(raw));
  const pairCounts = new Map<string, number>();
  const touched: Record<string, number> = {};

  for (const all of commits) {
    const files = all.filter(isIndexed);
    for (const f of files) touched[f] = (touched[f] ?? 0) + 1;
    if (files.length < 2 || files.length > CO_CHANGE_MAX_COMMIT_FILES) continue;
    files.sort();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i] + '\0' + files[j];
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const acc = new Map<string, Array<[string, number]>>();
  const add = (a: string, b: string, n: number) => {
    const list = acc.get(a);
    if (list) list.push([b, n]);
    else acc.set(a, [[b, n]]);
  };
  for (const [key, n] of pairCounts) {
    if (n < CO_CHANGE_MIN_SUPPORT) continue;
    const sep = key.indexOf('\0');
    const a = key.slice(0, sep), b = key.slice(sep + 1);
    add(a, b, n);
    add(b, a, n);
  }

  const partners: Record<string, Array<[string, number]>> = {};
  const keep = new Set<string>();
  for (const [file, list] of acc) {
    list.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    const top = list.slice(0, CO_CHANGE_K);
    partners[file] = top;
    keep.add(file);
    for (const [p] of top) keep.add(p);
  }
  // `touched` is only ever read as a denominator for a rendered pair — keeping
  // a count for every file the repo ever committed would dwarf the payload.
  const trimmedTouched: Record<string, number> = {};
  for (const f of keep) if (touched[f]) trimmedTouched[f] = touched[f];

  return {
    v: CO_CHANGE_VERSION,
    builtAt: Date.now(),
    head,
    commitsScanned: commits.length,
    partners,
    touched: trimmedTouched,
  };
}

export function coChangePath(rootDir: string, baseCacheDir?: string): string {
  return join(getCacheDir(rootDir, baseCacheDir), FILE_NAME);
}

/** Atomic write (temp + rename) — a reader never sees a half-written file.
 *  Plain JSON, not .gz: `saveCachedIndex` sweeps *.gz on every save. */
export async function saveCoChange(rootDir: string, data: CoChangeIndex, baseCacheDir?: string): Promise<void> {
  const path = coChangePath(rootDir, baseCacheDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, path);
}

/** Sync read for the query surfaces. null = absent/corrupt/wrong version, or
 *  no keeper has ever run here — callers omit the section entirely rather than
 *  claiming "no files move with this one". */
export function loadCoChange(rootDir: string, baseCacheDir?: string): CoChangeIndex | null {
  try {
    const p = coChangePath(rootDir, baseCacheDir);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as CoChangeIndex;
    if (parsed?.v !== CO_CHANGE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface CoChangePartner {
  path: string;
  /** Commits in which both files changed. */
  shared: number;
  /** Commits in the window that touched the QUERIED file. */
  outOf: number;
}

/**
 * Partners to render for one file, strongest first.
 *
 * `exclude` drops files the caller is already showing (imports, importers) —
 * repeating them spends the output budget without adding a file the agent
 * didn't already have. What survives is exactly the part the graph missed,
 * which is where the measured 10-14 point gain lives.
 */
export function coChangePartnersFor(
  data: CoChangeIndex | null,
  file: string,
  exclude: Set<string>,
  limit = CO_CHANGE_SHOW,
): CoChangePartner[] {
  if (!data) return [];
  const list = data.partners[file];
  if (!list?.length) return [];
  const outOf = data.touched[file] ?? 0;
  const out: CoChangePartner[] = [];
  for (const [path, shared] of list) {
    if (exclude.has(path)) continue;
    out.push({ path, shared, outOf });
    if (out.length >= limit) break;
  }
  return out;
}
