/**
 * `coldstart find <terms...>` — the rich-page query surface.
 *
 * One command, one page, one read. The design (verified against the arches
 * q03/q09 traces, see docs/) fuses two signals the two-tool surface kept apart:
 *
 *   - grep-RECALL for candidate selection: ripgrep every term across the repo,
 *     rank files by DISTINCT-TERM COVERAGE. This catches body-level matches the
 *     declared-name index misses (nested defs, dynamic refs) and is the reason a
 *     discriminating file rises — it covers MORE of the query than its lookalikes.
 *   - AST + grep PRECISION per candidate: for the top files, print indexed
 *     symbols (with line numbers) AND a filtered scan of body lines that contain
 *     the query terms (def/class/assignment lines first). The nested defs the
 *     parser cannot see and the `editable=False`-style context both show up here,
 *     inline — so the agent answers without a follow-up Read.
 *
 * Recall is bounded by the terms it is given: a one-token query cannot
 * out-rank lookalikes. The skill instructs the agent to pass every salient
 * identifier from the task — that is the load-bearing half of this command.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { CodebaseIndex, IndexedFile, SymbolNode } from '../types.js';
import { deriveRelatedFiles } from '../indexer/content-tokens.js';

/**
 * Candidate search is portable by design — no hard dependency on any external
 * binary. We try fast tools first and fall back to a pure-Node scan so the
 * command never silently returns empty on a machine without ripgrep/grep:
 *   rg → git grep → grep → in-process scan of indexed files.
 * The chosen backend is probed once per process.
 */
type Searcher = 'rg' | 'gitgrep' | 'grep' | 'node';
let _searcher: Searcher | null = null;

function probe(bin: string, args: string[], cwd: string): boolean {
  try {
    execFileSync(bin, args, { cwd, stdio: 'ignore', timeout: 4000 });
    return true;
  } catch (e: unknown) {
    // ENOENT = binary absent (unusable); any other exit = present but errored (usable)
    return (e as { code?: string }).code !== 'ENOENT';
  }
}

function pickSearcher(root: string): Searcher {
  if (_searcher) return _searcher;
  if (probe('rg', ['--version'], root)) _searcher = 'rg';
  else if (probe('git', ['rev-parse', '--is-inside-work-tree'], root)) _searcher = 'gitgrep';
  else if (probe('grep', ['--version'], root)) _searcher = 'grep';
  else _searcher = 'node';
  return _searcher;
}

const MAX_CANDIDATES_LISTED = 12;
const DETAIL_TOP = 3; // top files get an inline convergence preview; the rest list as bare paths

// Convergence-preview parameters (denoise hub files: show where the rarest terms cluster).
const WINDOW = 3;            // lines each side counted for local term convergence
const RARE_FRAC = 0.05;      // a term is a discriminator if it hits < 5% of candidate files
const MAX_PREVIEW_LINES = 8; // total body lines shown per file
const MAX_CLUSTERS = 2;      // distinct match regions shown per file
const IMPORT_RE =
  /^\s*(import\b|from\s+[\w.]+\s+import\b|export\s+[^=]*\bfrom\b|(?:const|let|var)\s+[^=]*=\s*require\s*\(|require\s*\(|use\s+[\w:\\]+|using\s+[\w.]+|#include\b|@import\b)/;

/** Prose/doc files (release notes, READMEs). They mention every term in plain
 * text and otherwise out-rank the source file the agent is actually looking for,
 * so they're partitioned into a secondary list rather than competing with code. */
const DOC_EXT = /\.(md|markdown|rst|txt|adoc|rdoc)$/i;
const isDoc = (rel: string): boolean => DOC_EXT.test(rel);
const MAX_DOC_CANDIDATES = 4;

/** Stylesheets match style vocabulary (sidebar/nav/menu as class names) and crowd code queries,
 * but ARE the right answer for a genuine CSS task — so they're partitioned into a bare list
 * (no preview, no evidence sentence) rather than dropped. SCSS is the source, never single it out. */
const STYLE_EXT = /\.(css|scss|sass|less)$/i;
const isStyle = (rel: string): boolean => STYLE_EXT.test(rel);
const MAX_STYLE_CANDIDATES = 4;

/** Minified bundles and vendored third-party trees are never the human-readable answer: a minified
 * file matches many terms on one giant line (inflating coverage) and previews as noise. Detected by
 * path (vendored tree / *.min.*) OR by content shape — chars-per-line ≫ real source (minified bundles
 * run 2700-43000 cpl, real source p99 ≈ 600), which catches un-suffixed bundles like nifty.js that the
 * path rule misses. Scoped to script/style languages so data/config files and golds are never touched.
 * Index-only (lineCount/tokenEstimate), NO file read. */
const VENDOR_PATH = /(^|\/)(node_modules|vendor|bower_components)\//i;
const MIN_SUFFIX = /\.min\.(js|css)$/i;
const SCRIPT_STYLE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|css|scss|sass|less)$/i;
const MINIFIED_CPL = 1000;
const isVendorOrMinified = (rel: string, file: IndexedFile): boolean => {
  if (VENDOR_PATH.test(rel) || MIN_SUFFIX.test(rel)) return true;
  return SCRIPT_STYLE_EXT.test(rel) && file.lineCount > 0
    && (file.tokenEstimate * 4) / file.lineCount > MINIFIED_CPL;
};

/**
 * Pass 1 — import co-citation among the candidate set (precision relations).
 *
 * For the files we're about to list, compute how they relate TO EACH OTHER via the
 * import graph, so the page can say "consumed by graph.py" instead of leaving the
 * agent to infer it. Three relations, strongest first:
 *   - consumes / consumedBy: a DIRECT import edge between two candidates (a fact).
 *   - siblings: two candidates share a non-hub import neighbour (co-citation). A
 *     shared neighbour imported by > HUB_DEGREE files is a utility hub, not evidence
 *     of relatedness, so it's discounted (offline: hub-discounted co-citation degree
 *     separated gold from lookalikes 2.05×; raw degree did not).
 * Index-only (outEdges/inEdges/importedByCount), NO file reads.
 */
const HUB_DEGREE = 30;
interface ImportRel { consumes: string[]; consumedBy: string[]; siblings: string[]; }

function computeImportRelations(index: CodebaseIndex, candidates: string[]): Map<string, ImportRel> {
  const candSet = new Set(candidates);
  // Non-hub neighbour signature per candidate: low-fanin import targets + low-fanout importers.
  // Importer ids are namespaced ('<' prefix) so a shared target and a shared importer never collide.
  const sig = new Map<string, Set<string>>();
  for (const c of candidates) {
    const s = new Set<string>();
    for (const t of index.outEdges.get(c) ?? []) {
      const f = index.files.get(t);
      if (f && f.importedByCount <= HUB_DEGREE) s.add(t);
    }
    for (const p of index.inEdges.get(c) ?? []) {
      if ((index.outEdges.get(p) ?? []).length <= HUB_DEGREE) s.add('<' + p);
    }
    sig.set(c, s);
  }
  const rels = new Map<string, ImportRel>();
  for (const c of candidates) {
    const outs = new Set(index.outEdges.get(c) ?? []);
    const ins = new Set(index.inEdges.get(c) ?? []);
    const consumes: string[] = [], consumedBy: string[] = [], siblings: string[] = [];
    const sc = sig.get(c)!;
    for (const d of candidates) {
      if (d === c) continue;
      if (outs.has(d)) { consumes.push(d); continue; }
      if (ins.has(d)) { consumedBy.push(d); continue; }
      const sd = sig.get(d)!;
      let shared = false;
      for (const n of sc) if (sd.has(n)) { shared = true; break; }
      if (shared) siblings.push(d);
    }
    rels.set(c, { consumes, consumedBy, siblings });
    void candSet;
  }
  return rels;
}

/** Clean a raw query into distinct, matchable terms (identifiers ≥3 chars). */
export function parseTerms(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw.split(/[\s[\]|,()'".]+/)) {
    if (w.length < 3 || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(w)) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Run the chosen external lister for one term; repo-relative paths ([] on miss/unsupported). */
function listFilesExternal(searcher: Searcher, root: string, term: string): string[] {
  const argv: Record<Exclude<Searcher, 'node'>, string[]> = {
    rg: ['-l', '-i', '-F', '--', term, '.'],
    // `-c grep.threads=1`: git grep defaults to one worker thread per core; on a
    // large repo the per-file work is trivial, so the threads thrash on the work
    // queue and burn the CPU in kernel scheduling (measured: ~15s sys / 100k+
    // context switches for a 16k-file repo, vs ~1s single-threaded). One thread
    // is both gentler on the CPU and faster in wall-clock here.
    // `--untracked`: also search new, uncommitted files — the index includes them
    // (the keeper watches live edits), but plain `git grep` only sees tracked files.
    gitgrep: ['-c', 'grep.threads=1', 'grep', '--untracked', '-l', '-i', '-F', '-I', '-e', term],
    grep: ['-r', '-l', '-i', '-F', '-I', '--', term, '.'],
  };
  const bin = searcher === 'gitgrep' ? 'git' : searcher;
  try {
    const out = execFileSync(bin, argv[searcher as Exclude<Searcher, 'node'>], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((l) => l.replace(/^\.\//, '').trim()).filter(Boolean);
  } catch {
    return []; // non-zero exit = no matches
  }
}

/**
 * Build term-coverage per indexed file. External searchers run per-term; the
 * Node fallback reads each indexed file once and tests all terms together.
 * Only files present in the index count (restricts to indexed code files).
 */
function collectCoverage(index: CodebaseIndex, root: string, terms: string[]): Map<string, Set<string>> {
  const coverage = new Map<string, Set<string>>();
  const add = (rel: string, term: string): void => {
    if (!index.files.has(rel)) return;
    let s = coverage.get(rel);
    if (!s) { s = new Set(); coverage.set(rel, s); }
    s.add(term);
  };

  const lowers = terms.map((t) => t.toLowerCase());

  // (A) body-content matches — what grep sees.
  const searcher = pickSearcher(root);
  if (searcher !== 'node') {
    for (const term of terms) {
      for (const rel of listFilesExternal(searcher, root, term)) add(rel, term);
    }
  } else {
    // Pure-Node fallback: one read per indexed file, all terms tested at once.
    for (const [rel, file] of index.files.entries()) {
      let text: string;
      try { text = readFileSync(file.path, 'utf8').toLowerCase(); } catch { continue; }
      for (let i = 0; i < terms.length; i++) {
        if (text.includes(lowers[i])) add(rel, terms[i]);
      }
    }
  }

  // (B) name/path/symbol matches — the signal grep CANNOT see. A file whose
  // distinguishing token is its own filename (e.g. 11726_join_tile_nodegroup.py)
  // or a declared symbol name is invisible to a body-content grep; without this
  // it sinks into a wall of equal-coverage lookalikes. This restores the
  // declared-name index that the two-tool GO surface ranked on.
  for (const [rel, file] of index.files.entries()) {
    const path = rel.toLowerCase();
    for (let i = 0; i < terms.length; i++) {
      const t = lowers[i];
      if (path.includes(t) || file.symbols.some((s) => s.name.toLowerCase().includes(t))) {
        add(rel, terms[i]);
      }
    }
  }
  return coverage;
}

/** Per-term document frequency over the candidate set (how many candidate files contain each term).
 * This is the rarity signal: a low-DF term is a discriminator, a high-DF term ("view" → 45% of files)
 * is noise that should neither rank a file nor light up a body line. */
function docFreq(coverage: Map<string, Set<string>>, terms: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, 0);
  for (const set of coverage.values()) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

/** Mark comment-only and docstring lines so they don't count as content matches — this is what kills
 * the "view"⊂"review" docstring noise and prose hits. Approximate (line-based) but cheap and language-agnostic. */
function excludedLines(lines: string[]): boolean[] {
  const ex = new Array<boolean>(lines.length).fill(false);
  let inTriple = false;
  let delim = '';
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (inTriple) {
      ex[i] = true;
      if (s.includes(delim)) inTriple = false;
      continue;
    }
    const m = s.match(/("""|''')/);
    if (m) {
      ex[i] = true;
      if ((s.split(m[1]).length - 1) % 2 === 1) { inTriple = true; delim = m[1]; }
      continue;
    }
    if (/^(#|\/\/|\/\*|\*|<!--|;;|--\s)/.test(s)) ex[i] = true;
  }
  return ex;
}

/** Innermost indexed symbol whose line range contains `line` (1-based) — used to LABEL a preview
 * cluster with its scope (e.g. "in class ResourceInstance"), not to print the whole symbol list. */
function enclosing(file: IndexedFile, line: number): SymbolNode | null {
  let best: SymbolNode | null = null;
  for (const s of file.symbols) {
    if (s.startLine <= line && line <= s.endLine) {
      if (!best || s.endLine - s.startLine < best.endLine - best.startLine) best = s;
    }
  }
  return best;
}

/**
 * Convergence preview: instead of dumping every line that mentions a term (which floods hub files
 * like models.py with matches from unrelated classes), score each matched line by RARITY-WEIGHTED
 * LOCAL CONVERGENCE — sum of 1/DF over the distinct query terms within ±WINDOW lines. The answer is
 * where the rare terms co-locate; scattered single-common-term matches score ~20-60× lower and drop out.
 * A matched line that is an import statement is boosted and annotated with its resolved target, because
 * it both marks a usage and points at the definition file.
 */
function convergencePreview(
  file: IndexedFile,
  terms: string[],
  df: Map<string, number>,
  nFiles: number,
  specToTarget: Array<{ spec: string; target: string }>,
): string[] {
  let text: string;
  try { text = readFileSync(file.path, 'utf8'); } catch { return []; }
  const lines = text.split('\n');
  const excl = excludedLines(lines);
  const lterms = terms.map((t) => t.toLowerCase());
  const weight = (t: string): number => nFiles / Math.max(1, df.get(t) ?? nFiles);
  const isRare = (t: string): boolean => (df.get(t) ?? nFiles) / nFiles < RARE_FRAC;

  // terms present in each non-excluded line
  const inLine: string[][] = lines.map((l, i) => {
    if (excl[i]) return [];
    const low = l.toLowerCase();
    return terms.filter((_t, k) => low.includes(lterms[k]));
  });

  interface Hit { line: number; score: number; }
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inLine[i].length === 0) continue;
    const windowTerms = new Set<string>();
    for (let j = Math.max(0, i - WINDOW); j <= Math.min(lines.length - 1, i + WINDOW); j++) {
      for (const t of inLine[j]) windowTerms.add(t);
    }
    // keep only discriminating lines: ≥2 distinct terms nearby, OR a rare term on the line itself.
    // (drops `resourceinstanceid` in an unrelated class — one common term, no neighbours.)
    if (windowTerms.size < 2 && !inLine[i].some(isRare)) continue;
    let score = 0;
    for (const t of windowTerms) score += weight(t);
    if (IMPORT_RE.test(lines[i])) score *= 1.5;
    hits.push({ line: i, score });
  }
  if (hits.length === 0) return [];

  // cluster kept hits by proximity, then rank clusters by peak score
  hits.sort((a, b) => a.line - b.line);
  const clusters: Hit[][] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && h.line - last[last.length - 1].line <= WINDOW) last.push(h);
    else clusters.push([h]);
  }
  const peakOf = (c: Hit[]): number => Math.max(...c.map((h) => h.score));
  clusters.sort((a, b) => peakOf(b) - peakOf(a));

  const out: string[] = [];
  let shown = 0;
  for (const cluster of clusters.slice(0, MAX_CLUSTERS)) {
    if (shown >= MAX_PREVIEW_LINES) break;
    const peak = cluster.reduce((a, b) => (b.score > a.score ? b : a));
    const sym = enclosing(file, peak.line + 1);
    out.push(sym
      ? `   in ${sym.kind} ${sym.name} [L${sym.startLine}-${sym.endLine}]:`
      : `   near L${peak.line + 1}:`);
    const lineSet = new Set(cluster.map((h) => h.line));
    const start = Math.max(0, cluster[0].line - 1);              // one context line above
    const end = Math.min(lines.length - 1, cluster[cluster.length - 1].line + 1); // and below
    for (let i = start; i <= end && shown < MAX_PREVIEW_LINES; i++) {
      if (excl[i] && !lineSet.has(i)) continue;   // skip comment context, keep comment only if it's a hit
      const raw = lines[i].trim().slice(0, 120);
      if (!raw) continue;
      let suffix = '';
      if (IMPORT_RE.test(lines[i])) {
        const tgt = specToTarget.find((st) => st.spec && lines[i].includes(st.spec));
        if (tgt) suffix = `   → defined in ${tgt.target}`;
      }
      out.push(`     L${i + 1}: ${raw}${suffix}`);
      shown++;
    }
  }
  return out;
}

export function buildRichPage(index: CodebaseIndex, root: string, rawQuery: string, asData = false, via = false): string {
  const terms = parseTerms(rawQuery);
  if (terms.length === 0) {
    return 'find: no usable terms. Pass the salient identifiers from the task, e.g. `coldstart find ResourceInstance principaluser editable`.';
  }

  // 1. grep-recall: term → indexed files, accumulate distinct-term coverage.
  const coverage = collectCoverage(index, root, terms);

  if (coverage.size === 0) {
    return `find: no indexed file contains any of [${terms.join(', ')}].\nThese identifiers may not exist in the repo, or be in excluded/binary files. Reformulate, or grep directly.`;
  }

  const df = docFreq(coverage, terms);
  const nFiles = index.files.size;
  const lterms = terms.map((t) => t.toLowerCase());
  const rareTerms = terms.filter((t) => (df.get(t) ?? nFiles) / nFiles < RARE_FRAC);

  // Rarity (BM25-style IDF): a term hitting few files is a discriminator; a common domain
  // token (order/payment/view) hits ~everything → near-zero weight. This is what makes the
  // ranker robust on domain-heavy repos and what keeps it from promoting hubs.
  const idf = (t: string): number => {
    const d = df.get(t) ?? 0;
    return Math.log(1 + (nFiles - d + 0.5) / (d + 0.5));
  };
  const maxIdf = Math.max(1, ...terms.map(idf));

  // Relevance score — index-only, NO file reads (term frequency was measured to add nothing
  // once name/path are in play; see find-ranking sim). Binary term-coverage sets the tier;
  // within/across tiers a file is lifted by rarity-weighted evidence that a term NAMES a
  // declared symbol here (definition signal) or appears in the PATH. Length-free + IDF-weighted,
  // so the 2700-line hub gets no edge. (Offline: top-12 recall 67%→79%, hub-misfires ~halved.)
  const NAME_W = 3, PATH_W = 2;
  const scoreCache = new Map<string, number>();
  const score = (rel: string): number => {
    let v = scoreCache.get(rel);
    if (v !== undefined) return v;
    const file = index.files.get(rel)!;
    const pathLow = rel.toLowerCase();
    let boost = 0;
    for (let k = 0; k < terms.length; k++) {
      const t = lterms[k];
      if (!t) continue;
      if (file.symbols.some((s) => s.name.toLowerCase().includes(t))) boost += NAME_W * idf(terms[k]);
      if (pathLow.includes(t)) boost += PATH_W * idf(terms[k]);
    }
    v = coverage.get(rel)!.size * 3 + boost / maxIdf;
    scoreCache.set(rel, v);
    return v;
  };

  // rank: relevance score desc, then path (stable). importedBy dropped — centrality was the hub trap.
  const ranked = [...coverage.entries()].sort((a, b) => {
    const d = score(b[0]) - score(a[0]);
    return d !== 0 ? d : a[0].localeCompare(b[0]);
  });

  // Per-file MATCH EVIDENCE, as a short plain-English sentence — what the file actually does with the
  // query terms, strongest signal first: declares a symbol of that name > the term is in its path >
  // the term is imported here (a consumer, not the definer) > a rare term sits in its body. Common
  // (non-discriminating) body terms are omitted — every file matches them, so listing them is the
  // noise we're cutting. `disc` (count of discriminating signals) doubles as the NOISE FLOOR:
  // disc===0 means the file matched only common words → dropped from the listing. Index-only
  // (graph edges + declared symbols), NO file reads; cached per file.
  const rareSet = new Set(rareTerms);
  const tick = (s: string): string => `\`${s}\``;
  // Does `rel` import a definition that carries `term`? A term appearing on an import line resolves
  // to an out-edge whose target file is named for the term or declares a symbol of that name. Cheap:
  // walks only this file's out-edges. Lets the sentence say "imports X" (consumer) vs "mentions X".
  const importTargetFor = (rel: string, term: string): string | null => {
    const tl = term.toLowerCase();
    for (const tgt of index.outEdges.get(rel) ?? []) {
      if (tgt.toLowerCase().includes(tl)) return tgt;
      const tf = index.files.get(tgt);
      if (tf && tf.symbols.some((s) => s.name.toLowerCase().includes(tl))) return tgt;
    }
    return null;
  };
  // Grade-1 symbol locator: for a previewed file, the DECLARED symbols whose name matches a
  // discriminating query term, with their line ranges — so the agent reads the right offset
  // instead of windowing a large file to find them. The convergence preview shows where rare
  // terms CLUSTER (often an incidental method); this shows where the NAMED symbols LIVE — the
  // agent's actual read targets. (q22 read graph.py 8× hunting for serialize/restore_state that
  // the index had located at L1965/L2098.) Index-only, NO file read. Container symbols that
  // enclose another matched symbol are dropped (keep the specific method, not the 2800-line class).
  const MATCHED_SYM_CAP = 6;
  const MATCHED_SYM_MIN_LINES = 80; // only worth it on files big enough to hunt within
  // Gate symbol matching on terms that DISCRIMINATE THIS QUERY (idf ≥ the query's median), not the
  // global 5% rare threshold: `serialize`/`restore` are common repo-wide but are exactly the symbols
  // a "graph serialize restore" query wants, while generic `graph`/`function` would flood a god-file.
  const sortedIdf = terms.map(idf).sort((a, b) => a - b);
  const medIdf = sortedIdf[Math.floor((sortedIdf.length - 1) / 2)];
  const discTermIdx = terms.map((_t, k) => k).filter((k) => idf(terms[k]) >= medIdf);

  // Structured ranking export (--json): the real score(), coverage, and per-file
  // symbol-binding (NAME channel) + path-binding for every term — so a convergence
  // characterization reads the ranker's actual numbers, not a parse of the page.
  if (asData) {
    const discSet = new Set(discTermIdx.map((k) => lterms[k]));
    const rows = ranked.slice(0, 40).map(([rel]) => {
      const file = index.files.get(rel)!;
      const pathLow = rel.toLowerCase();
      const defines: string[] = [], inPath: string[] = [];
      for (let k = 0; k < terms.length; k++) {
        const t = lterms[k];
        if (!t) continue;
        if (file.symbols.some((s) => s.name.toLowerCase().includes(t))) defines.push(terms[k]);
        if (pathLow.includes(t)) inPath.push(terms[k]);
      }
      // does a DISCRIMINATING term bind to a declared symbol here? (Signal 1)
      const defsDisc = defines.filter((t) => discSet.has(t.toLowerCase()));
      return { path: rel, score: +score(rel).toFixed(4), coverage: coverage.get(rel)!.size,
               defines, inPath, definesDiscriminating: defsDisc };
    });
    return JSON.stringify({
      terms, nFiles, rareTerms,
      discTerms: discTermIdx.map((k) => terms[k]),
      idf: Object.fromEntries(terms.map((t) => [t, +idf(t).toFixed(4)])),
      ranked: rows,
    });
  }

  const matchedSymbols = (rel: string): string[] => {
    const file = index.files.get(rel)!;
    if (file.lineCount < MATCHED_SYM_MIN_LINES) return [];
    const hits = file.symbols.filter((s) => {
      const nl = s.name.toLowerCase();
      return discTermIdx.some((k) => nl.includes(lterms[k]));
    });
    if (hits.length === 0) return [];
    // drop a symbol if it strictly contains another matched symbol (keep the inner, specific one)
    const specific = hits.filter((s) =>
      !hits.some((o) => o !== s && o.startLine >= s.startLine && o.endLine <= s.endLine
        && (o.startLine > s.startLine || o.endLine < s.endLine)));
    // rank by rarity-weighted term match (Σ idf of distinct discriminating terms in the name), so the
    // most query-specific methods win the cap; tiebreak by line order for readability.
    const symScore = (s: { name: string }): number => {
      const nl = s.name.toLowerCase();
      return discTermIdx.reduce((acc, k) => acc + (nl.includes(lterms[k]) ? idf(terms[k]) : 0), 0);
    };
    return specific
      .sort((a, b) => symScore(b) - symScore(a) || a.startLine - b.startLine)
      .slice(0, MATCHED_SYM_CAP)
      .sort((a, b) => a.startLine - b.startLine)
      .map((s) => `${s.name} [L${s.startLine}-${s.endLine}]`);
  };

  interface Evidence {
    text: string; disc: number;
    declares: string[]; inPath: string[];
    imports: Array<{ term: string; from: string }>; mentions: string[];
  }
  const evCache = new Map<string, Evidence>();
  const evidence = (rel: string): Evidence => {
    const cached = evCache.get(rel);
    if (cached) return cached;
    const file = index.files.get(rel)!;
    const pathLow = rel.toLowerCase();
    const matched = coverage.get(rel)!;
    const declares: string[] = [], inPath: string[] = [], mentions: string[] = [];
    const imports: Array<{ term: string; from: string }> = [];
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k];
      if (!matched.has(t)) continue;
      if (file.symbols.some((s) => s.name.toLowerCase().includes(lterms[k]))) { declares.push(t); continue; }
      if (pathLow.includes(lterms[k])) { inPath.push(t); continue; }
      if (!rareSet.has(t)) continue; // common body-only term → noise, omit
      const tgt = importTargetFor(rel, t);
      if (tgt) imports.push({ term: t, from: tgt });
      else mentions.push(t);
    }
    const parts: string[] = [];
    if (declares.length) parts.push(`Defines ${declares.map(tick).join(', ')}.`);
    if (inPath.length) parts.push(`Named for ${inPath.map(tick).join(', ')} (in its path).`);
    for (const im of imports) parts.push(`Imports ${tick(im.term)} from ${im.from}.`);
    if (mentions.length) parts.push(`Mentions ${mentions.map(tick).join(', ')} in its body.`);
    const disc = declares.length + inPath.length + imports.length + mentions.length;
    const res: Evidence = { text: parts.join(' '), disc, declares, inPath, imports, mentions };
    evCache.set(rel, res);
    return res;
  };
  // Compact "Role:" line — the file's identity in query terms, strongest signal first, one line.
  const roleText = (rel: string): string => {
    const ev = evidence(rel);
    const segs: string[] = [];
    if (ev.declares.length) segs.push(`defines ${ev.declares.map(tick).join(', ')}`);
    if (ev.inPath.length) segs.push(`named for ${ev.inPath.map(tick).join(', ')}`);
    if (ev.imports.length) segs.push(`imports ${ev.imports.map((i) => tick(i.term)).join(', ')} (from ${base(ev.imports[0].from)})`);
    if (ev.mentions.length) segs.push(`mentions ${ev.mentions.map(tick).join(', ')}`);
    return segs.join('; ');
  };

  // Partition the listing. Vendored/minified bundles are dropped outright (never an answer); code
  // files lead with previews; stylesheets and prose/docs split into bare secondary lists so they can't
  // crowd or out-rank the source file. NOISE FLOOR: drop code files with no discriminating evidence.
  const droppedCount = ranked.filter(([rel]) => isVendorOrMinified(rel, index.files.get(rel)!)).length;
  const kept = ranked.filter(([rel]) => !isVendorOrMinified(rel, index.files.get(rel)!));
  const styleRanked = kept.filter(([rel]) => isStyle(rel));
  const docRanked = kept.filter(([rel]) => isDoc(rel));
  const codeRanked = kept.filter(([rel]) => !isDoc(rel) && !isStyle(rel) && evidence(rel).disc > 0);

  const lines: string[] = [];
  lines.push(`find: ${terms.join(' ')}  (${terms.length} terms, ${coverage.size} candidate files)`);
  if (rareTerms.length === 0) {
    lines.push(`  ⚠ no discriminating term — all of [${terms.join(', ')}] are common in this repo. Add a specific symbol, filename, or field name and re-run.`);
  }
  lines.push('');

  // Top files get an inline convergence preview; the rest list as bare paths (cheap landscape,
  // and `| head` truncation now drops whole tail files instead of cutting every file's evidence).
  const detailSet = (codeRanked.length > 0 ? codeRanked : docRanked).slice(0, DETAIL_TOP);
  const candidateList = codeRanked.slice(0, MAX_CANDIDATES_LISTED).map(([rel]) => rel);
  const candidateSet = new Set(candidateList);

  // Pass 1 — import co-citation among the listed candidates (precision relations).
  const relations = computeImportRelations(index, candidateList);
  const base = (rel: string): string => rel.split('/').pop() ?? rel;
  // Query-grounded "via" (A/B variant only): the connecting term = a DISCRIMINATING term the DEFINER
  // declares that the CONSUMER also matched — i.e. the rare query identifier that flows across the edge.
  // Filtered to discriminating terms (idf ≥ query median): a common connector like `graph`/`delete`
  // sits on every edge and is noise; the rare one (`LoadStaging`) is the meaning-making token. No reads.
  const discLower = new Set(discTermIdx.map((k) => lterms[k]));
  const viaTerms = (definer: string, other: string): string[] => {
    const decl = new Set(evidence(definer).declares.map((t) => t.toLowerCase()));
    if (decl.size === 0) return [];
    const out: string[] = [];
    for (const t of coverage.get(other) ?? []) {
      const tl = t.toLowerCase();
      if (decl.has(tl) && discLower.has(tl)) out.push(t);
    }
    return out.sort((a, b) => idf(b) - idf(a)).slice(0, 2);
  };
  // Render the relation line for a candidate, strongest signal first, capped. When `via`, annotate each
  // edge with the query term that connects the two files (the "consumed in X via blah" the agent asked for).
  const relText = (rel: string, via: boolean): string => {
    const r = relations.get(rel);
    if (!r) return '';
    const label = (other: string, definer: string, consumer: string): string => {
      if (!via) return tick(base(other));
      const vs = viaTerms(definer, consumer);
      return `${tick(base(other))}${vs.length ? ` (via ${vs.map(tick).join(', ')})` : ''}`;
    };
    const parts: string[] = [];
    if (r.consumedBy.length) parts.push(`used by ${r.consumedBy.slice(0, 3).map((d) => label(d, rel, d)).join(', ')}`);
    if (r.consumes.length) parts.push(`uses ${r.consumes.slice(0, 3).map((d) => label(d, d, rel)).join(', ')}`);
    if (r.siblings.length) parts.push(`near ${r.siblings.slice(0, 3).map((d) => tick(base(d))).join(', ')}`);
    return parts.join(' · ');
  };

  // Soft anchor: the connected set the agent should NAME, not just the file it opens. If ≥2 of the
  // top files relate to each other, say so up front — the recall losses were the agent answering from
  // one opened file and dropping the cluster it never read.
  const connected = detailSet.filter(([rel]) => {
    const r = relations.get(rel);
    return r && (r.consumedBy.length || r.consumes.length || r.siblings.length);
  }).length;

  lines.push('== matches (top files previewed; ranked by term coverage + definition/path match) ==');
  if (connected >= 2) {
    lines.push(
      "Several of these top files reference each other (see Wired: below) — they're likely one connected answer set; the connected files belong in your answer even if you don't open each one.",
    );
  }
  detailSet.forEach(([rel, ts]) => {
    const file = index.files.get(rel)!;
    lines.push('');
    lines.push(`▸ ${rel}   [${ts.size}/${terms.length}]`);
    const role = roleText(rel);
    if (role) lines.push(`   Role:  ${role}`);
    const syms = matchedSymbols(rel);
    if (syms.length) lines.push(`   Read:  ${syms.join(', ')}`);
    const rt = relText(rel, via);
    if (rt) lines.push(`   Wired: ${rt}`);
    const specToTarget = index.edges
      .filter((e) => e.from === rel)
      .map((e) => ({ spec: e.specifier, target: index.files.get(e.to)?.relativePath ?? e.to }));
    const preview = convergencePreview(file, terms, df, nFiles, specToTarget);
    if (preview.length) for (const p of preview) lines.push(p);
    else lines.push('     (no discriminating line — terms appear scattered; open the file)');
  });

  const rest = codeRanked.slice(DETAIL_TOP, MAX_CANDIDATES_LISTED);
  if (rest.length > 0) {
    lines.push('');
    lines.push('-- more candidates (paths + what matched) --');
    for (const [rel, ts] of rest) {
      const role = roleText(rel);
      const rt = relText(rel, via);
      const tail = [role, rt].filter(Boolean).join(' · ');
      lines.push(`  [${ts.size}/${terms.length}] ${rel}${tail ? `  — ${tail}` : ''}`);
    }
  }
  if (codeRanked.length > MAX_CANDIDATES_LISTED) {
    lines.push(`  [+${codeRanked.length - MAX_CANDIDATES_LISTED} more lower-coverage code files]`);
  }
  if (droppedCount > 0) {
    lines.push(`  [${droppedCount} vendor/minified file${droppedCount === 1 ? '' : 's'} hidden]`);
  }

  // Pass 2 — shared-rare-token bridge (recall). For each previewed file, find files that
  // co-mention the same rare, identifier-shaped tokens but produce NO import edge — the
  // implicit-reference relations (migrations↔models, config-by-name, JS↔Python pairs) that the
  // import graph cannot see. Gated by deriveRelatedFiles: cross-dir only, import-edge dedup,
  // ≥2 shared tokens OR string-literal provenance, twin-merge, cap 3. Index-only, NO file reads.
  const bridgeExclude = new Set(candidateSet);
  for (const [rel] of detailSet) bridgeExclude.add(rel);
  // Query-relevance gate. A bridge survives only if a shared token relates to a query
  // stem. Without it, any file sharing an unrelated rare token with a big top match
  // (e.g. a migration that touches one of models.py's many unrelated fields) surfaces —
  // measured offline as 73% of related entries, all recurring noise (9075_external_oauth,
  // 0001_initial, …); the query-relevant gold (q19 javascript.htm via `term…`) survives.
  const qStems = new Set<string>();
  for (const t of terms) {
    const tl = t.toLowerCase();
    if (tl.length >= 4) qStems.add(tl);
    for (const part of tl.split(/[_\W]+/)) if (part.length >= 4) qStems.add(part);
  }
  const relatesToQuery = (toks: string[]): boolean =>
    qStems.size === 0 ||
    toks.some((tok) => {
      const tl = tok.toLowerCase();
      for (const s of qStems) if (tl.includes(s) || s.includes(tl)) return true;
      return false;
    });
  const bridged: Array<{ from: string; fileId: string; tokens: string[]; alsoFileIds?: string[] }> = [];
  const bridgedSeen = new Set<string>();
  for (const [rel] of detailSet) {
    const src = index.files.get(rel);
    if (!src?.contentTokens) continue;
    for (const rf of deriveRelatedFiles(rel, src.contentTokens, index, bridgeExclude)) {
      if (bridgedSeen.has(rf.fileId)) continue;
      if (!relatesToQuery(rf.tokens)) continue;
      bridgedSeen.add(rf.fileId);
      bridgeExclude.add(rf.fileId);
      bridged.push({ from: rel, fileId: rf.fileId, tokens: rf.tokens, alsoFileIds: rf.alsoFileIds });
    }
  }
  if (bridged.length > 0) {
    lines.push('');
    lines.push('-- related files (no import edge; share rare identifiers with a top match) --');
    for (const b of bridged.slice(0, 6)) {
      const also = b.alsoFileIds?.length ? ` (+${b.alsoFileIds.length} similar)` : '';
      lines.push(`  ${b.fileId}${also}   — shares ${b.tokens.slice(0, 3).map(tick).join(', ')} with ${base(b.from)}`);
    }
  }

  if (styleRanked.length > 0) {
    lines.push('');
    lines.push('-- stylesheets matching your terms (css/scss — not previewed) --');
    for (const [rel, ts] of styleRanked.slice(0, MAX_STYLE_CANDIDATES)) {
      lines.push(`  [${ts.size}/${terms.length}] ${rel}`);
    }
  }

  if (docRanked.length > 0) {
    lines.push('');
    lines.push('-- docs/notes mentioning your terms (prose, not definitions) --');
    for (const [rel, ts] of docRanked.slice(0, MAX_DOC_CANDIDATES)) {
      lines.push(`  [${ts.size}/${terms.length}] ${rel}`);
    }
  }

  lines.push('');
  lines.push('Previews show where your rarest terms converge (comments/docstrings filtered, ±1 context line). If the answer is not here, add a more discriminating term and re-run.');
  return lines.join('\n');
}







