/**
 * Content-token link channel.
 *
 * Extracts rare, identifier-shaped tokens from full file bodies (case
 * preserved) and derives relations between files that share them. This is the
 * display-side twin of the implicit-reference resolver gap: literal-name
 * references that produce NO import edge (Django migrations ↔ models,
 * config-by-name registration, JS ↔ Python pairs) still co-mention the same
 * rare identifiers. Evidence, not classification: we show the shared token
 * and let the agent infer the relation. Ranking is never touched.
 *
 * Token gates (each empirically backed — see docs/token-link-enrichment-spec.md):
 * - shape: multi-word snake_case / camelCase / PascalCase / ALL_CAPS only
 *   (kills prose: 'preference', 'ideally'). Case is PRESERVED — lowercasing
 *   hid SEARCH_ITEMS_PER_PAGE and false-killed real camelCase links.
 * - provenance: comment-derived occurrences dropped at extraction;
 *   string-literal occurrences flagged (highest-precision class).
 * - corpus df ∈ [2, DF_MAX]: df=1 links nothing, df>MAX is vocabulary.
 * - vendored/minified assets and markdown excluded at extraction;
 *   test files and barrels excluded from postings.
 */
import type { CodebaseIndex, IndexedFile } from '../types.js';

// Provenance bit flags per token (OR of all occurrences in the file)
export const TOKEN_IN_CODE = 1;
export const TOKEN_IN_STRING = 2;

export const CONTENT_TOKEN_DF_MIN = 2;
export const CONTENT_TOKEN_DF_MAX = 5;
// Per-file unique-token safety cap (generated monsters)
const MAX_TOKENS_PER_FILE = 3000;
const MIN_TOKEN_LENGTH = 4;

// ---------------------------------------------------------------------------
// Shape gate — identifier-shaped multi-word tokens only, case preserved
// ---------------------------------------------------------------------------
const SHAPE_SNAKE = /^[a-z][a-z0-9]*(?:_+[a-z0-9]+)+$/;
const SHAPE_CAMEL = /^[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+$/;
const SHAPE_PASCAL = /^(?:[A-Z][a-z0-9]+){2,}$/;
const SHAPE_ALL_CAPS = /^[A-Z][A-Z0-9]*(?:_+[A-Z0-9]+)+$/;

export function isShapedToken(t: string): boolean {
  return (
    t.length >= MIN_TOKEN_LENGTH &&
    (SHAPE_SNAKE.test(t) || SHAPE_CAMEL.test(t) || SHAPE_PASCAL.test(t) || SHAPE_ALL_CAPS.test(t))
  );
}

// ---------------------------------------------------------------------------
// Vendored / minified asset exclusion (jquery.min.js polluted real pages with
// browser-API tokens). The walker already skips vendor/node_modules dirs;
// this catches checked-in copies living under media/static/assets paths.
// ---------------------------------------------------------------------------
const VENDORED_SEGMENT = /(?:^|\/)(?:vendor|vendors|third[-_]party|external|packages?\/lib)(?:\/|$)/i;

export function isVendoredAssetPath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (/\.(?:min|bundle|pack)\.(?:js|css)$/.test(lower)) return true;
  if (/-min\.(?:js|css)$/.test(lower)) return true;
  return VENDORED_SEGMENT.test(lower);
}

// ---------------------------------------------------------------------------
// Extraction — per line: pull string-literal spans first (their tokens get
// TOKEN_IN_STRING), truncate at a comment marker, scan the rest as code.
// Line-based comment handling is deliberately heuristic-generic (no
// per-language tree-sitter pass in v1); the shape gate kills most prose that
// slips through (e.g. multi-line docstrings).
// ---------------------------------------------------------------------------
const STRING_SPAN = /(["'`])(?:\\.|(?!\1).)*?\1/g;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

function commentStart(line: string): number {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('<!--')) return 0;
  let cut = -1;
  const consider = (idx: number): void => {
    if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
  };
  consider(line.indexOf('//'));
  consider(line.indexOf('/*'));
  consider(line.indexOf('#'));
  consider(line.indexOf('<!--'));
  // SQL/Lua-style `--` only when it reads as a comment (start or space-delimited)
  const dashes = line.match(/(?:^|\s)--(?:\s|$)/);
  if (dashes && dashes.index !== undefined) consider(dashes.index);
  return cut;
}

function addToken(out: Record<string, number>, count: { n: number }, token: string, bit: number): void {
  if (!isShapedToken(token)) return;
  const existing = out[token];
  if (existing === undefined) {
    if (count.n >= MAX_TOKENS_PER_FILE) return;
    out[token] = bit;
    count.n++;
  } else {
    out[token] = existing | bit;
  }
}

/**
 * Extract shaped content tokens with provenance bits from a file body.
 * Returns undefined for excluded files (vendored assets, markdown) so the
 * field stays absent rather than empty.
 */
export function extractContentTokens(
  content: string,
  relativePath: string,
): Record<string, number> | undefined {
  if (isVendoredAssetPath(relativePath)) return undefined;
  if (/\.(?:md|markdown)$/i.test(relativePath)) return undefined;

  const out: Record<string, number> = {};
  const count = { n: 0 };

  for (const rawLine of content.split('\n')) {
    if (rawLine.length > 2000) continue; // minified/generated line — skip
    // 1. String literals → TOKEN_IN_STRING, then blank them out
    let line = rawLine;
    STRING_SPAN.lastIndex = 0;
    line = line.replace(STRING_SPAN, span => {
      WORD.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WORD.exec(span)) !== null) addToken(out, count, m[0], TOKEN_IN_STRING);
      return ' ';
    });

    // 2. Truncate at comment marker — comment-derived tokens are a measured
    //    noise class, dropped entirely
    const cut = commentStart(line);
    if (cut === 0) continue;
    if (cut > 0) line = line.slice(0, cut);

    // 3. Remaining identifiers → TOKEN_IN_CODE
    WORD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD.exec(line)) !== null) addToken(out, count, m[0], TOKEN_IN_CODE);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Postings — token → fileIds, kept only for df ∈ [DF_MIN, DF_MAX].
// Test files and barrels are excluded: links to tests are noise on GO pages
// (tests are excluded from results by default) and barrels are excluded from
// results entirely.
// ---------------------------------------------------------------------------
export function buildContentTokenPostings(
  files: Iterable<IndexedFile>,
): Map<string, string[]> {
  const postings = new Map<string, string[]>();
  for (const file of files) {
    if (file.isTestFile || file.isBarrel || !file.contentTokens) continue;
    for (const token of Object.keys(file.contentTokens)) {
      const list = postings.get(token);
      if (list === undefined) postings.set(token, [file.id]);
      else if (list.length <= CONTENT_TOKEN_DF_MAX) list.push(file.id);
    }
  }
  for (const [token, list] of postings) {
    if (list.length < CONTENT_TOKEN_DF_MIN || list.length > CONTENT_TOKEN_DF_MAX) {
      postings.delete(token);
    }
  }
  return postings;
}

// ---------------------------------------------------------------------------
// Link derivation
// ---------------------------------------------------------------------------
export interface TokenLink {
  a: string; // fileId, page-rank order (a before b)
  b: string;
  alsoB?: string[]; // twin-cluster members merged into this link (near-identical token sets)
  tokens: string[];
  hasStringProvenance: boolean;
  minDf: number;
}

// Two token sets are "twins" when they are mostly the SAME set (Jaccard) —
// the signature of boilerplate siblings (migration twins share the same SQL
// trigger body). Twin links from the same host collapse into one display
// line so a twin cluster consumes ONE cap slot, not all of them (measured
// failure: three SQL-twin links squeezed the q16 gold link off the page).
// Jaccard, not overlap-of-smaller: a 2-token link whose tokens happen to
// appear inside a 6-token twin body is a DIFFERENT relation, not a twin.
function tokenOverlap(x: string[], y: string[]): number {
  const xs = new Set(x);
  let common = 0;
  for (const t of y) if (xs.has(t)) common++;
  return common / (x.length + y.length - common);
}
const TWIN_OVERLAP_THRESHOLD = 0.6;

function dirOf(fileId: string): string {
  const i = fileId.lastIndexOf('/');
  return i === -1 ? '' : fileId.slice(0, i);
}

function hasImportEdge(index: CodebaseIndex, a: string, b: string): boolean {
  return (
    (index.outEdges.get(a)?.includes(b) ?? false) ||
    (index.outEdges.get(b)?.includes(a) ?? false)
  );
}

function tokenHasStringBit(index: CodebaseIndex, fileId: string, token: string): boolean {
  const bits = index.files.get(fileId)?.contentTokens?.[token];
  return bits !== undefined && (bits & TOKEN_IN_STRING) !== 0;
}

// Strength gate. ≥2 shared tokens or string-literal provenance qualifies
// outright. A single code-provenance token qualifies only when it is BOTH
// ultra-rare (df ≤ 3) and ≥3 words — replay-derived: the q16 gold link is
// exactly `limit_choices_to` (df 3, 3 words, code provenance) while the
// measured weak-single noise class was all 2-word generics (new_ids,
// child_node, settings_utils).
function tokenWordCount(t: string): number {
  const parts = t.split(/_+/).filter(Boolean);
  let count = 0;
  for (const p of parts) {
    count += Math.max(1, (p.match(/[A-Z]/g)?.length ?? 0) + (/^[a-z]/.test(p) ? 1 : 0));
  }
  return count;
}

function linkIsStrong(
  tokens: string[],
  hasStringProvenance: boolean,
  index: CodebaseIndex,
): boolean {
  if (tokens.length >= 2 || hasStringProvenance) return true;
  const t = tokens[0];
  const df = index.contentTokenPostings.get(t)?.length ?? CONTENT_TOKEN_DF_MAX + 1;
  return df <= 3 && tokenWordCount(t) >= 3;
}

function compareLinkStrength(x: TokenLink, y: TokenLink): number {
  if (x.hasStringProvenance !== y.hasStringProvenance) return x.hasStringProvenance ? -1 : 1;
  if (x.tokens.length !== y.tokens.length) return y.tokens.length - x.tokens.length;
  return x.minDf - y.minDf;
}

/**
 * Derive token links among a page of GO results.
 *
 * Gates, in order: query-stem suppression (a token containing a query word
 * links by construction), cross-directory only (same-dir pairs are
 * boilerplate twins), import-edge redundancy (an in-page edge is already
 * rendered as `← imported by`), strength (≥2 shared tokens OR string-literal
 * provenance), triangle dedupe (a link transitively implied by two stronger
 * links is dropped), per-page cap.
 */
export const TOKEN_LINKS_PER_PAGE = 3;

export function deriveInPageTokenLinks(
  pageIds: string[],
  index: CodebaseIndex,
  queryTokens: string[] = [],
): TokenLink[] {
  if (pageIds.length < 2 || index.contentTokenPostings.size === 0) return [];
  const rankOf = new Map(pageIds.map((id, i) => [id, i]));
  const stems = queryTokens.map(t => t.toLowerCase()).filter(t => t.length >= 3);

  // token → page members, each token visited once
  const seen = new Set<string>();
  const pairTokens = new Map<string, string[]>(); // "a b" → tokens

  for (const id of pageIds) {
    const tokens = index.files.get(id)?.contentTokens;
    if (!tokens) continue;
    for (const token of Object.keys(tokens)) {
      if (seen.has(token)) continue;
      seen.add(token);
      const lower = token.toLowerCase();
      if (stems.some(s => lower.includes(s))) continue;
      const postings = index.contentTokenPostings.get(token);
      if (!postings) continue;
      const members = postings
        .filter(p => rankOf.has(p))
        .sort((x, y) => rankOf.get(x)! - rankOf.get(y)!);
      if (members.length < 2) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          if (dirOf(a) === dirOf(b)) continue;
          if (hasImportEdge(index, a, b)) continue;
          const key = a + ' ' + b;
          const list = pairTokens.get(key);
          if (list === undefined) pairTokens.set(key, [token]);
          else list.push(token);
        }
      }
    }
  }

  const links: TokenLink[] = [];
  for (const [key, tokens] of pairTokens) {
    const [a, b] = key.split(' ');
    const hasStringProvenance = tokens.some(
      t => tokenHasStringBit(index, a, t) || tokenHasStringBit(index, b, t),
    );
    if (!linkIsStrong(tokens, hasStringProvenance, index)) continue;
    const minDf = Math.min(
      ...tokens.map(t => index.contentTokenPostings.get(t)?.length ?? CONTENT_TOKEN_DF_MAX),
    );
    // Rarest token first in display
    tokens.sort(
      (x, y) =>
        (index.contentTokenPostings.get(x)?.length ?? CONTENT_TOKEN_DF_MAX) -
        (index.contentTokenPostings.get(y)?.length ?? CONTENT_TOKEN_DF_MAX),
    );
    links.push({ a, b, tokens, hasStringProvenance, minDf });
  }

  links.sort(compareLinkStrength);

  // Triangle dedupe: drop A–C when stronger links A–B and B–C exist and
  // jointly carry all of A–C's tokens (the third side is transitively implied)
  const byPair = new Map<string, TokenLink>();
  const adjacency = new Map<string, Set<string>>();
  const kept: TokenLink[] = [];
  for (const link of links) {
    const neighborsA = adjacency.get(link.a);
    const neighborsB = adjacency.get(link.b);
    let implied = false;
    if (neighborsA && neighborsB) {
      for (const mid of neighborsA) {
        if (!neighborsB.has(mid)) continue;
        const ab = byPair.get(pairKey(link.a, mid));
        const bc = byPair.get(pairKey(mid, link.b));
        if (!ab || !bc) continue;
        const union = new Set([...ab.tokens, ...bc.tokens]);
        if (link.tokens.every(t => union.has(t))) {
          implied = true;
          break;
        }
      }
    }
    if (implied) continue;
    kept.push(link);
    byPair.set(pairKey(link.a, link.b), link);
    if (!adjacency.has(link.a)) adjacency.set(link.a, new Set());
    if (!adjacency.has(link.b)) adjacency.set(link.b, new Set());
    adjacency.get(link.a)!.add(link.b);
    adjacency.get(link.b)!.add(link.a);
  }

  // Twin-cluster merge: same host, near-identical token sets → one link line
  const grouped: TokenLink[] = [];
  for (const link of kept) {
    const host = grouped.find(
      g => g.a === link.a && tokenOverlap(g.tokens, link.tokens) >= TWIN_OVERLAP_THRESHOLD,
    );
    if (host) {
      (host.alsoB ??= []).push(link.b);
      continue;
    }
    grouped.push(link);
  }

  return grouped.slice(0, TOKEN_LINKS_PER_PAGE);
}

function pairKey(x: string, y: string): string {
  return x < y ? x + ' ' + y : y + ' ' + x;
}

// ---------------------------------------------------------------------------
// GS-side: files related to a source token set (file-level or match-region)
// ---------------------------------------------------------------------------
export interface RelatedFile {
  fileId: string;
  alsoFileIds?: string[]; // twin-cluster members merged into this entry
  tokens: string[]; // shared rare tokens (rarest first), empty for pure name-echo
  viaName?: string; // name-echo: the term the filename matched
  hasStringProvenance: boolean;
  minDf: number;
}

export const RELATED_FILES_CAP = 3;

export function deriveRelatedFiles(
  sourceFileId: string,
  sourceTokens: Record<string, number>,
  index: CodebaseIndex,
  excludeIds: Set<string>,
): RelatedFile[] {
  const shared = new Map<string, string[]>(); // candidate fileId → tokens
  const sourceDir = dirOf(sourceFileId);

  for (const token of Object.keys(sourceTokens)) {
    const postings = index.contentTokenPostings.get(token);
    if (!postings) continue;
    for (const candidate of postings) {
      if (candidate === sourceFileId || excludeIds.has(candidate)) continue;
      if (dirOf(candidate) === sourceDir) continue;
      if (hasImportEdge(index, sourceFileId, candidate)) continue;
      const list = shared.get(candidate);
      if (list === undefined) shared.set(candidate, [token]);
      else list.push(token);
    }
  }

  const related: RelatedFile[] = [];
  for (const [fileId, tokens] of shared) {
    const hasStringProvenance = tokens.some(
      t =>
        (sourceTokens[t] & TOKEN_IN_STRING) !== 0 ||
        tokenHasStringBit(index, fileId, t),
    );
    if (!linkIsStrong(tokens, hasStringProvenance, index)) continue;
    const minDf = Math.min(
      ...tokens.map(t => index.contentTokenPostings.get(t)?.length ?? CONTENT_TOKEN_DF_MAX),
    );
    tokens.sort(
      (x, y) =>
        (index.contentTokenPostings.get(x)?.length ?? CONTENT_TOKEN_DF_MAX) -
        (index.contentTokenPostings.get(y)?.length ?? CONTENT_TOKEN_DF_MAX),
    );
    related.push({ fileId, tokens, hasStringProvenance, minDf });
  }

  related.sort((x, y) => {
    if (x.hasStringProvenance !== y.hasStringProvenance) return x.hasStringProvenance ? -1 : 1;
    if (x.tokens.length !== y.tokens.length) return y.tokens.length - x.tokens.length;
    return x.minDf - y.minDf;
  });

  // Twin-cluster merge (boilerplate siblings share near-identical token sets)
  const grouped: RelatedFile[] = [];
  for (const r of related) {
    const host = grouped.find(g => tokenOverlap(g.tokens, r.tokens) >= TWIN_OVERLAP_THRESHOLD);
    if (host) {
      (host.alsoFileIds ??= []).push(r.fileId);
      continue;
    }
    grouped.push(r);
  }
  return grouped.slice(0, RELATED_FILES_CAP);
}

/**
 * Name-echo: files whose FILENAME matches one of the agent's `match` terms.
 * Separator-insensitive substring (UserPreference ↛ userpreference.py was a
 * measured miss), df-gated (common terms like `resource` hit 50+ filenames —
 * skip the term entirely rather than flood).
 */
export const NAME_ECHO_MAX_FILES_PER_TERM = 5;

export function deriveNameEchoFiles(
  terms: string[],
  index: CodebaseIndex,
  excludeIds: Set<string>,
): RelatedFile[] {
  const out: RelatedFile[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const norm = term.toLowerCase().replace(/[_\-\s]/g, '');
    if (norm.length < MIN_TOKEN_LENGTH) continue;
    const hits: string[] = [];
    for (const file of index.files.values()) {
      if (file.isTestFile || file.isBarrel) continue;
      const base = file.id.split('/').pop() ?? '';
      const baseNorm = base.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[_\-.]/g, '');
      if (!baseNorm.includes(norm)) continue;
      hits.push(file.id);
      if (hits.length > NAME_ECHO_MAX_FILES_PER_TERM) break;
    }
    if (hits.length === 0 || hits.length > NAME_ECHO_MAX_FILES_PER_TERM) continue;
    for (const id of hits) {
      if (excludeIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ fileId: id, tokens: [], viaName: term, hasStringProvenance: false, minDf: hits.length });
    }
  }
  return out;
}
