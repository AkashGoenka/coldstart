/**
 * kb search — the 3rd core tool. A cold agent arrives with WORDS, no filenames;
 * this is tried before `find`.
 *
 * Lane 1 (words→notes): task words vs title/aliases (weight 3), anchor
 * paths+symbols+facet symbols (weight 2), prose incl. facet details (weight 1)
 * — scored by in-house BM25 over the NOTE corpus (idf · tf-saturation · length
 * normalization; defaults k1=1.2 b=0.75, weights tuned on real corpora).
 * Lane 2 (code→notes): a term naming a symbol DECLARED in an anchored file
 * surfaces the note even when the note never stored the symbol — resolved via
 * the keeper-maintained notes index (per-anchor symbol inventories), never by
 * scanning the code index here (C1 decoupling).
 *
 * Results carry freshness computed NOW (never trusted from write time);
 * absence notes print the keeper's re-run verdict stamp. Active+fresh
 * notes outrank stale/superseded ones as a hard tier, score within tier.
 *
 * Every zero-hit query is appended to the miss-log — the alias bet's failure
 * mode is SILENT (the agent just falls through to `find`), so the miss-log is
 * the health metric and the future source of real aliases.
 */
import type { FoldedNote, StampedAnchor } from './types.js';
import { stampCoversTerms, type KbNotesIndex } from './notes-index.js';
import { parseTerms } from '../server/find.js';
import { stampAnchors, freshnessLine, anchorsAllMissing } from './freshness.js';
import { loadAll, logMetric } from './store.js';
import { NOTES_REL } from './raw-log.js';
import { renderNote } from './render.js';

export interface KbSearchOptions {
  /** Keeper-maintained notes index for lane 2, absence stamps, and the
   *  convergence implant gate. Load via loadKbNotesIndex(root) — a plain
   *  sidecar read, safe in hook mode too. Omit → those channels degrade. */
  notesIndex?: KbNotesIndex | null;
  maxResults?: number;
  /** Where the query came from — recorded in the miss-log. */
  source?: 'tool' | 'hook';
  /** Suppress miss-log writes (used by write-time candidate matching). */
  noMissLog?: boolean;
  /**
   * Precision mode for the recall hook, whose "query" is an arbitrary user
   * sentence: match AND score on the name/alias/anchor channels only (body
   * coverage is trivially satisfied by long prompts sharing the repo's domain
   * vocabulary — phase-1 arches: 12/12 body-graze injections, all irrelevant,
   * and body coverage let padding outrank the true hit), then drop hits far
   * below the best one (padding, not signal). Explicit tool calls stay loose
   * (the agent chose its terms).
   */
  strongOnly?: boolean;
}

// English glue words that survive parseTerms' ≥3-char rule but carry zero
// signal over prose notes. (find doesn't need this — code rarely contains
// "the" as an identifier; note bodies always do.)
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'where',
  'what', 'which', 'how', 'why', 'does', 'not', 'are', 'was', 'were', 'has',
  'have', 'had', 'can', 'could', 'should', 'would', 'will', 'you', 'your',
  'its', 'her', 'his', 'they', 'them', 'there', 'here', 'about', 'after',
  'before', 'over', 'under', 'then', 'than', 'all', 'any', 'each', 'more',
  'some', 'such', 'only', 'also', 'just', 'being', 'been', 'did', 'do',
  'get', 'gets', 'let', 'lets', 'like', 'make', 'makes', 'need', 'needs',
  'please', 'want', 'use', 'used', 'using', 'way', 'now', 'new', 'out',
]);

export interface KbSearchHit {
  note: FoldedNote;
  score: number;
  /** 0 = active+all-anchors-fresh · 1 = active but stale · 2 = superseded/retracted
   *  · 3 = inactive (every anchored file absent on this branch). */
  tier: number;
  /** Read-time projection: every anchored file is absent right now (branch
   *  switch / deletion / unresolved rename). Recall drops these; tool search
   *  keeps them at the bottom, labelled. Never true for lessons. */
  inactive: boolean;
  stamped: StampedAnchor[];
  /** Absence-note re-run verdict line, when applicable. */
  absence?: string;
  /** A code-shaped query term is DECLARED (per the keeper's per-anchor symbol
   *  inventory) in one of this note's anchor files — the code index agreeing
   *  with the text match. The high-precision implant gate; false when the
   *  notes index wasn't provided. */
  convergence: boolean;
  /** Distinct eligible query terms that hit this note's NAME/ANCHOR channels.
   *  In hook mode only eligible (minority + shape-ok) terms count, so this is
   *  a scale-free convergence measure: a boilerplate graze shares ONE word
   *  with the top note; a task that names a mechanism lands several. */
  strongTerms: number;
}

export interface KbSearchResult {
  hits: KbSearchHit[];
  terms: string[];
  warnings: string[];
  /** Hits the cap dropped that still cleared the results floor — a real second
   *  page, not tail grazes. The number the --max footer advertises; absent/0
   *  means nothing was worth widening for. */
  omitted?: number;
  /** The cap actually applied (opts.maxResults ?? default) — the base for the
   *  footer's suggested --max value. */
  maxUsed?: number;
}

const norm = (s: string): string => s.toLowerCase();
const squash = (s: string): string => s.toLowerCase().replace(/[-_/.\s]+/g, '');

interface Haystacks {
  name: string; nameSquash: string; nameRaw: string;
  anchor: string; anchorSquash: string;
  body: string;
}

function haystacksFor(note: FoldedNote): Haystacks {
  const name = [note.title, ...note.aliases].join(' ');
  // Facet symbols are addresses — they sit in the anchor channel with the
  // other (path, symbol) vocabulary; facet details are prose (body).
  const anchor = [
    ...note.anchors.map((a) => [a.path, ...(a.symbols ?? [])].join(' ')),
    ...note.facets.map((f) => f.symbol),
  ].join(' ');
  const body = [
    note.summary ?? '',
    note.body ?? '',
    ...note.facets.map((f) => f.detail),
    ...note.behaviors.map((b) => `${b.concept_id} ${(b.symbols ?? []).join(' ')} ${b.detail}`),
    ...note.features.map((f) => `${f.concept_id} ${f.role}`),
    ...note.steps.map((s) => `${s.path} ${(s.symbols ?? []).join(' ')} ${s.role}`),
    ...note.invariants,
    ...(note.scope?.terms ?? []),
  ].join(' ');
  return { name: norm(name), nameSquash: squash(name), nameRaw: name, anchor: norm(anchor), anchorSquash: squash(anchor), body: norm(body) };
}

// ---- BM25 (tool-mode scoring) ------------------------------------------------
// In-house BM25F-lite: per-term score = idf · saturation(weighted tf, doc length).
// Rare terms discriminate (idf), repeated matches saturate (k1), and long notes
// stop winning on vocabulary volume (b · len/avgLen) — the length normalization
// the old coverage formula lacked. Channel weights name×3 / anchor×2 / body×1
// are DEFAULTS; tune against the validation-run corpus, not incidents.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const CHANNEL_W = { name: 3, anchor: 2, body: 1 } as const;

/** Results-page relevance floor: a hit scoring below this fraction of the top
 *  hit is a graze, not an answer. Two uses, one constant: renderResultsPage
 *  drops sub-floor hits from the page, and kbSearch counts cap-omitted hits
 *  ABOVE it to decide whether the --max footer is worth showing (a floor-only
 *  tail isn't — widening would surface nothing new). */
const RESULTS_FLOOR = 0.25;

/** Hook-mode injection gate: the top hit must be matched by at least one
 *  DISCRIMINATING term — df ≤ ceil(N/DIVISOR) (rare in this notebook's own
 *  vocabulary). Boilerplate prompts ("list the files", "fix the bug and
 *  update the tests") match only common words; a real task always names its
 *  mechanism. Scale-free — a df ratio, not a score constant — so it neither
 *  drifts as the corpus grows nor silences terse single-symbol prompts the
 *  way an absolute score floor would. Applied only in the calibrated regime
 *  (≥ MIN notes): on a young notebook every df is small, rarity means
 *  nothing, and a weak pointer page costs a glance, not a poisoning. */
const HOOK_RARITY_DIVISOR = 10;
const HOOK_FLOOR_MIN_NOTES = 30;
const rarityMax = (n: number): number => Math.ceil(n / HOOK_RARITY_DIVISOR);
/** Convergence override on the rarity gate: a top hit with no RARE term still
 *  injects when ≥ this many distinct eligible terms land in its name/anchor
 *  channels. Rarity tests one term's discrimination; this tests agreement —
 *  a prompt whose mechanism is named entirely in common words ("how the ids
 *  search filter works") converges 4+ minority words on the right note, while
 *  a boilerplate graze shares 1–2 ("fix the failing tests" → a tests/ note).
 *  Scale-free like the df ratio: each counted term must already be a minority
 *  word (df·2 ≤ N), so common vocabulary drops out of the count as the corpus
 *  grows instead of inflating it. Calibrated on the 117-note replay corpus
 *  (2026-07-08): boilerplate max 2, known-graze 3, false suppressions 4–5.
 *  strongTerms is logged on every injection decision for re-calibration. */
const HOOK_CONVERGE_MIN = 4;

/** Path-name override: when the raw prompt literally contains a note's anchor
 *  path (case/separator-insensitive), the user named that file — surface its
 *  note regardless of term rarity. parseTerms drops `/`-glued paths (the `/`
 *  fails its alnum token filter) and sub-3-char extensions, so a bare path like
 *  "arches/urls.py" yields ZERO terms; without this, naming a file is a no-op.
 *  The anchor-path squash must be ≥ this many chars to fire, so trivially short
 *  paths can't graze arbitrary prose. Boost dominates term scores so the named
 *  file leads its freshness tier. */
const PATH_MATCH_MIN_SQUASH = 6;
const PATH_MATCH_BOOST = 100;

const tokenCount = (s: string): number => (s ? s.split(/\s+/).filter(Boolean).length : 0);

/** Substring occurrence count in normalized text; a squash-only match counts 1. */
function countOcc(hay: string, haySquash: string, term: string): number {
  const t = norm(term);
  let n = 0;
  for (let i = hay.indexOf(t); i >= 0; i = hay.indexOf(t, i + t.length)) n++;
  if (!n && haySquash.includes(squash(term))) n = 1;
  return n;
}

/** Weighted doc length for BM25 normalization (same channel weights as tf). */
function bm25Len(h: Haystacks): number {
  return CHANNEL_W.name * tokenCount(h.name) + CHANNEL_W.anchor * tokenCount(h.anchor) + CHANNEL_W.body * tokenCount(h.body);
}

/** Determine if a term has code shape beyond single leading capital.
 *  Code-shaped means it contains digits, underscores, hyphens, or uppercase
 *  letters in non-initial positions (camelCase, PascalCase, ALLCAPS).
 *  Single-capital words like "Add" are not code-shaped (they're prose with
 *  sentence-initial capitalization). */
function isCodeShaped(term: string): boolean {
  // Contains digit, underscore, or hyphen
  if (/[0-9_-]/.test(term)) return true;
  // Contains uppercase at position > 0 (interior caps, ALLCAPS)
  if (term.length > 1 && /[A-Z]/.test(term.slice(1))) return true;
  return false;
}

/** Whole-word, case-insensitive hit — "error" must not match "LoadErrors". */
function wordHit(hay: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay);
}

/** Case- and separator-insensitive containment (LoadStaging ≡ load_staging). */
function hits(hay: string, haySquash: string, term: string): boolean {
  const t = norm(term);
  return hay.includes(t) || haySquash.includes(squash(term));
}

/** Lane 2: term → anchored files it names (path or a symbol DECLARED in the
 *  file, per the keeper's per-anchor inventory — no code-index scan). */
function resolveTermToAnchors(kb: KbNotesIndex, term: string): Set<string> {
  const out = new Set<string>();
  const t = norm(term);
  for (const [path, symbols] of Object.entries(kb.anchors)) {
    if (norm(path).includes(t) || symbols.some((s) => norm(s).includes(t))) out.add(path);
  }
  return out;
}

/** Convergence channel: files where the term matches a DECLARED SYMBOL only —
 *  stricter than lane 2 (path-segment grazes don't count). Calibrated on the
 *  27q corpus: symbol agreement was 100%-precise at rank 0; path inclusion
 *  wasn't part of that measurement, so it stays out of the gate. */
function resolveTermToSymbolFiles(kb: KbNotesIndex, term: string): Set<string> {
  const out = new Set<string>();
  const t = norm(term);
  for (const [path, symbols] of Object.entries(kb.anchors)) {
    if (symbols.some((s) => norm(s).includes(t))) out.add(path);
  }
  return out;
}

/** An absence note's verdict comes from the keeper's stamp (it re-runs the
 *  stored search on every code/notebook change) — never from a live scan here. */
function absenceVerdict(note: FoldedNote, kb: KbNotesIndex | null | undefined): string | undefined {
  if (note.kind !== 'absence' || !note.scope?.terms.length) return undefined;
  const stamp = kb?.absence[note.id];
  // No stamp, or the note's terms changed since the keeper last looked → unverified.
  if (!stampCoversTerms(stamp, note.scope.terms)) return '[absence not re-verified — no keeper stamp yet]';
  const paths = stamp.matches;
  if (!paths.length) return '[absence holds — search still returns nothing]';
  return `[absence STALE — now matches: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` +${paths.length - 3} more` : ''}]`;
}

export async function kbSearch(root: string, query: string, opts: KbSearchOptions = {}): Promise<KbSearchResult> {
  const max = opts.maxResults ?? 3;
  const { notes, warnings } = loadAll(root);
  const terms = parseTerms(query).filter((t) => !STOPWORDS.has(t.toLowerCase()));
  // Path-name override (recall only): the raw prompt literally naming a note's
  // anchor path surfaces that note even when parseTerms yields nothing — a
  // `/`-glued path fails the alnum token filter and a 2-char extension drops,
  // so "what does arches/urls.py do" would otherwise leave no terms to match.
  const querySquash = squash(query);
  const pathNamedIds = new Set<string>();
  if (opts.strongOnly) {
    for (const note of notes) {
      if (note.anchors.some((a) => { const ps = squash(a.path); return ps.length >= PATH_MATCH_MIN_SQUASH && querySquash.includes(ps); })) {
        pathNamedIds.add(note.id);
      }
    }
  }
  if (!notes.length || (!terms.length && !pathNamedIds.size)) {
    if (notes.length && !opts.noMissLog) logMetric(root, 'miss-log', { query, source: opts.source ?? 'tool', reason: 'no-terms' });
    return { hits: [], terms, warnings };
  }

  const stacks = notes.map(haystacksFor);

  // Lane 2: term → anchored files via the keeper's notes index.
  const termFiles = new Map<string, Set<string>>();
  if (opts.notesIndex) for (const t of terms) termFiles.set(t, resolveTermToAnchors(opts.notesIndex, t));

  // idf over the note corpus — rare terms discriminate, ubiquitous ones don't.
  const df = terms.map((t) => stacks.filter((h) => hits(h.name + ' ' + h.anchor + ' ' + h.body, h.nameSquash + h.anchorSquash, t)).length);
  const idf = (k: number): number => Math.log(1 + notes.length / (1 + df[k]));

  // BM25 length normalization inputs (tool mode).
  const lens = stacks.map(bm25Len);
  const avgLen = Math.max(1, lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length));

  // Convergence channel: code-shaped term → files where it's a declared symbol.
  const symFiles = new Map<string, Set<string>>();
  if (opts.notesIndex) {
    for (const t of terms) if (isCodeShaped(t)) symFiles.set(t, resolveTermToSymbolFiles(opts.notesIndex, t));
  }

  const rareMax = rarityMax(notes.length);
  const scored: { note: FoldedNote; score: number; convergence: boolean; rare: boolean; strongTerms: number }[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const h = stacks[i];
    let covered = 0;
    let boost = 0;
    let strong = false;
    let strongTerms = 0;
    let convergence = false;
    let rare = false;
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k];
      const inName = hits(h.name, h.nameSquash, t);
      let inAnchor = hits(h.anchor, h.anchorSquash, t);
      // Lane-2 admission (term matches ONLY via the keeper's symbol inventory)
      // stays off in strongOnly: an arbitrary sentence sharing one symbol with
      // a hub anchor file (datatypes.py declares hundreds) is a graze, not a
      // hit — enabling it here produced false implants on the 27q replay. The
      // convergence gate below still uses the inventory, but only to CONFIRM a
      // term the note matched in its own text (two independent channels).
      if (!inAnchor && !opts.strongOnly && termFiles.get(t)?.size) {
        const files = termFiles.get(t)!;
        inAnchor = note.anchors.some((a) => files.has(a.path));
      }
      const inBody = h.body.includes(norm(t));
      if (!inName && !inAnchor && !inBody) continue;
      // Hook-mode term eligibility — the query is an arbitrary English
      // sentence, so a term counts only when it (a) DISCRIMINATES (a word
      // matching half the notebook — "save", "files" — identifies nothing)
      // and (b) matches by shape: a code-shaped term (LoadStaging, file-list,
      // max_files) may substring-match any name/anchor, but a plain English
      // word must whole-word-match the AUTHORED name channel — "error" inside
      // "LoadErrors" or "base" inside "base.py" is a collision, not a hit.
      if (opts.strongOnly) {
        const minority = df[k] === 1 || df[k] * 2 <= notes.length;
        const shapeOk = isCodeShaped(t) ? inName || inAnchor : wordHit(h.nameRaw, t);
        if (!minority || !shapeOk) continue;
      }
      covered++;
      if (inName || inAnchor) { strong = true; strongTerms++; }
      if (df[k] <= rareMax) rare = true;
      const files = symFiles.get(t);
      if (files?.size && note.anchors.some((a) => files.has(a.path))) convergence = true;
      if (opts.strongOnly) {
        // Hook mode keeps its calibrated presence·idf boost (unwired in the
        // validation config; kept intact for a possible injection A/B).
        boost += ((inName ? 3 : 0) + (inAnchor ? 2 : 0) + (inBody ? 1 : 0)) * idf(k);
      } else {
        // BM25: term frequency across weighted channels, saturated by k1,
        // normalized by doc length. Lane-2 anchor admission (presence with no
        // text occurrence) counts as one anchor-channel occurrence.
        const wtf =
          CHANNEL_W.name * countOcc(h.name, h.nameSquash, t) +
          CHANNEL_W.anchor * Math.max(countOcc(h.anchor, h.anchorSquash, t), inAnchor ? 1 : 0) +
          CHANNEL_W.body * countOcc(h.body, '', t);
        const idfB = Math.log(1 + (notes.length - df[k] + 0.5) / (df[k] + 0.5));
        boost += (idfB * (wtf * (BM25_K1 + 1))) / (wtf + BM25_K1 * (1 - BM25_B + (BM25_B * lens[i]) / avgLen));
      }
    }
    // Path-name override: the prompt named this note's file → treat as a strong,
    // discriminating hit and boost it to the top of its tier, bypassing the
    // term-rarity eligibility gate (and the suppression gate, via rare=true).
    if (opts.strongOnly && pathNamedIds.has(note.id)) {
      if (!covered) covered = 1;
      strong = true;
      rare = true;
      strongTerms = Math.max(strongTerms, 1);
      boost += PATH_MATCH_BOOST;
    }
    if (!covered) continue;
    if (opts.strongOnly && !strong) continue; // body-word coverage ≠ a hit on an arbitrary sentence
    scored.push({ note, score: boost, convergence, rare, strongTerms });
  }

  if (!scored.length) {
    if (!opts.noMissLog) logMetric(root, 'miss-log', { query, terms, source: opts.source ?? 'tool' });
    return { hits: [], terms, warnings };
  }

  // Freshness NOW for everything scored, then hard-tier: fresh+active first.
  const rareById = new Map(scored.map((s) => [s.note.id, s.rare]));
  const withTier: KbSearchHit[] = scored.map(({ note, score, convergence, strongTerms }) => {
    // The keeper's rename overlay lets a note whose file was renamed resolve to
    // its new path ('moved', not 'missing'), so a byte-exact refactor doesn't
    // send the note inactive. Live-re-verified inside stampAnchors.
    const stamped = stampAnchors(root, note.anchors, opts.notesIndex?.renames);
    // Lessons are exempt (an absence lesson is ABOUT non-existence); any other
    // note whose anchored files are all gone is inactive on this branch.
    const inactive = note.type !== 'lesson' && anchorsAllMissing(stamped);
    const stale = stamped.some((s) => s.state === 'changed' || s.state === 'missing');
    const tier = inactive ? 3 : note.status !== 'active' ? 2 : stale ? 1 : 0;
    return { note, score, tier, inactive, stamped, absence: absenceVerdict(note, opts.notesIndex), convergence, strongTerms };
  });
  // Recall (hook mode) must never inject a note whose subject doesn't exist on
  // the current branch — a review/feature-branch note viewed from elsewhere.
  // Tool search keeps them (findable, bottom tier, labelled below).
  const surfaced = opts.strongOnly ? withTier.filter((h) => !h.inactive) : withTier;
  surfaced.sort((a, b) => a.tier - b.tier || b.score - a.score || (a.note.id < b.note.id ? -1 : 1));

  // Hook-mode rarity gate (calibrated 2026-07-06, 117-note arches corpus:
  // 27/27 real prompts inject, 8/8 boilerplate probes silent): a top hit
  // matched only by common vocabulary ("list the files", "fix the bug and
  // update the tests") is a graze, and the whole page is suppressed —
  // silence, zero tax. Scale-free (a df ratio, not a score constant), so
  // terse single-symbol prompts still inject and nothing drifts as the
  // corpus grows. Every suppression is metric-logged for re-calibration.
  // The convergence override (HOOK_CONVERGE_MIN) rescues the one measured
  // false-suppression mode: a real task named entirely in common words.
  if (
    opts.strongOnly && notes.length >= HOOK_FLOOR_MIN_NOTES && surfaced.length &&
    !rareById.get(surfaced[0].note.id) && surfaced[0].strongTerms < HOOK_CONVERGE_MIN
  ) {
    if (!opts.noMissLog) logMetric(root, 'inject-log', { query: query.slice(0, 200), suppressed: true, top: surfaced[0].note.id, score: Math.round(surfaced[0].score * 10) / 10, strongTerms: surfaced[0].strongTerms });
    return { hits: [], terms, warnings };
  }

  // Hook mode: hits far below the best are padding (a generic path segment
  // grazing an anchor), not a second answer — don't inject them.
  const trimmed = opts.strongOnly && surfaced.length > 1
    ? surfaced.filter((h) => h.score >= 0.4 * surfaced[0].score)
    : surfaced;

  // Hits the cap dropped that still clear the results floor — a genuine second
  // page. The footer offers --max only when this is non-zero; a tail trimmed
  // by the floor (not the cap) isn't worth widening for.
  const top = trimmed[0]?.score ?? 0;
  const omitted = trimmed.slice(max).filter((h) => h.score >= RESULTS_FLOOR * top).length;

  return { hits: trimmed.slice(0, max), terms, warnings, omitted, maxUsed: max };
}

/** Body section of the rendered md (frontmatter stripped) for inlining. */
function noteBody(note: FoldedNote): string {
  const md = renderNote(note);
  const end = md.indexOf('\n---\n', 3);
  return end >= 0 ? md.slice(end + 5).trim() : md.trim();
}

/** Implant gate — should the TOP hit's full body ride in the injection?
 *
 *  Layered, no absolute score constant (27q calibration, 2026-07-05):
 *  1. convergence — a code-shaped query term is a declared symbol in the
 *     note's anchor files (index agrees with text): 11/11 precise at rank 0.
 *  2. dominance — sole surviving hit, or top score ≥ 1.8× the runner-up. A
 *     scale-free ratio within one query's own result list; unlike an absolute
 *     cut it doesn't drift with notebook size or repo vocabulary.
 *  Together: 22/23 relevant implanted, zero false implants on that corpus.
 *  Neither fires → gist tier, which is the pre-implant behavior. */
export function shouldImplantTop(result: KbSearchResult): boolean {
  const h = result.hits;
  if (!h.length) return false;
  if (h[0].convergence) return true;
  return h.length === 1 || h[0].score >= 1.8 * h[1].score;
}

const gistLines = (hit: KbSearchHit): string[] => {
  const n = hit.note;
  const kind = n.type === 'lesson' && n.kind ? `/${n.kind}` : '';
  const status = n.status !== 'active' ? ` · ${n.status.toUpperCase()}` : '';
  const changed = hit.stamped.filter((s) => s.state === 'changed' || s.state === 'missing');
  const moved = hit.stamped.filter((s) => s.state === 'moved');
  const fresh =
    !hit.stamped.length ? '' :
    changed.length ? ` · [evidence changed: ${changed.slice(0, 2).map((s) => s.path).join(', ')}${changed.length > 2 ? ` +${changed.length - 2}` : ''}]` :
    moved.length ? ` · [moved → ${moved.slice(0, 2).map((s) => s.movedTo).join(', ')}${moved.length > 2 ? ` +${moved.length - 2}` : ''}]` :
    hit.stamped.every((s) => s.state === 'fresh') ? ' · anchors [fresh]' : ' · [not fully verified]';
  // Hub file notes carry knowledge in facets, not a body — their gist is the
  // symbol inventory (what the note knows about), not prose.
  const facetGist = n.facets.length ? `facets: ${n.facets.map((f) => f.symbol).join(', ')}` : '';
  const gistSrc = (n.summary || n.body || facetGist || n.invariants[0] || '').replace(/\s+/g, ' ').trim();
  const lines = [`- **${n.title}**  [${n.type}${kind}${status}]${fresh}`];
  lines.push(`  → open: ${NOTES_REL}/${n.id}.md`);
  // Same preview grade as the kb search results page (user ruling 2026-07-08:
  // precise delivery may not always work — every hit carries enough preview to
  // judge, and depth is one Read of the open: path away). Still never a full
  // body: the boilerplate-poisoning ruling stands.
  let prose = gistSrc;
  if (prose.length > 340) prose = prose.slice(0, 340) + '…';
  for (const l of wrapText(prose, 110)) lines.push(`  ${l}`);
  if (hit.absence) lines.push(`  ${hit.absence}`);
  return lines;
};

/** Hook-mode page — PREVIEW GRADE, never full-body (structural ruling
 *  2026-07-06, after the boilerplate-poisoning incident: a wrong full-body
 *  implant demotes the right notes; a wrong preview costs one glance).
 *  Every hit renders as title + freshness + `→ open:` path + the same
 *  ~340-char wrapped preview as the kb search results page (2026-07-08:
 *  a lone surgical gist gave the agent nothing to judge it against — q14
 *  wrong-prime; candidates with previews let it pick or reject). Full depth
 *  is one Read of the open: path. shouldImplantTop stays exported for a
 *  future injection A/B. Injected context is re-read every turn, so the
 *  page stays small. */
export function renderCompactPage(query: string, result: KbSearchResult): string {
  if (!result.hits.length) {
    return `No notebook notes match "${query}". Fall through to \`coldstart find\` as usual.`;
  }
  const lines: string[] = [];
  for (const hit of result.hits) lines.push(...gistLines(hit));
  return lines.join('\n');
}

/** Tool-mode results page — search-engine shape (user ruling 2026-07-08):
 *  many ranked results, each title + live freshness + an OPENABLE note-file
 *  path + a ~3-line preview. Depth is one Read away, so breadth is cheap and
 *  a ranker miss costs a glance, not the answer. The relative score floor
 *  drops tail grazes (a generic path segment matching one anchor) that a
 *  wider page would otherwise pad with. */
export function renderResultsPage(query: string, result: KbSearchResult): string {
  if (!result.hits.length) {
    return `No notebook notes match "${query}". Fall through to \`coldstart find\` as usual.`;
  }
  const shown = result.hits.filter((h) => h.score >= RESULTS_FLOOR * result.hits[0].score);
  const parts: string[] = [`# Notebook results for: ${query}  (${shown.length} match${shown.length === 1 ? '' : 'es'})`, ''];
  shown.forEach((hit, i) => {
    const n = hit.note;
    const kind = n.type === 'lesson' && n.kind ? `/${n.kind}` : '';
    const changed = hit.stamped.filter((s) => s.state === 'changed' || s.state === 'missing');
    const moved = hit.stamped.filter((s) => s.state === 'moved');
    const fresh =
      hit.inactive ? 'INACTIVE — every anchored file absent on this branch' :
      n.status !== 'active' ? n.status.toUpperCase() :
      !hit.stamped.length ? 'unverified' :
      changed.length ? `evidence changed: ${changed.slice(0, 2).map((s) => s.path).join(', ')}${changed.length > 2 ? ` +${changed.length - 2}` : ''}` :
      moved.length ? `moved → ${moved.slice(0, 2).map((s) => s.movedTo).join(', ')}${moved.length > 2 ? ` +${moved.length - 2}` : ''}` :
      hit.stamped.every((s) => s.state === 'fresh') ? 'fresh' : 'not fully verified';
    parts.push(`${i + 1}. ${n.title}  [${n.type}${kind} · ${fresh} · ${n.updated.slice(0, 10)}]`);
    parts.push(`   → open: ${NOTES_REL}/${n.id}.md`);
    const facetGist = n.facets.length ? `facets: ${n.facets.map((f) => f.symbol).join(', ')}` : '';
    let prose = (n.summary || n.body || n.invariants[0] || facetGist || '').replace(/\s+/g, ' ').trim();
    if (prose.length > 340) prose = prose.slice(0, 340) + '…';
    for (const l of wrapText(prose, 110)) parts.push(`   ${l}`);
    if (hit.absence) parts.push(`   ${hit.absence}`);
    parts.push('');
  });
  if (result.omitted && result.omitted > 0) {
    const next = (result.maxUsed ?? shown.length) + result.omitted;
    parts.push(
      `+${result.omitted} more note${result.omitted === 1 ? '' : 's'} matched above the relevance floor but were cut by the result cap — re-run with \`--max ${next}\` to see them.`,
      '',
    );
  }
  parts.push(
    'Open a result\'s note file (Read/cat) for the full detail — flow steps, invariants, per-symbol facets, exact anchors. ' +
    'Anything marked [evidence changed] must be re-verified against the cited file before you rely on it.',
  );
  return parts.join('\n');
}

function wrapText(s: string, width: number): string[] {
  if (!s) return [];
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Full-body page: every hit inlined whole. Kept for `--json` (programmatic
 *  consumers get the complete page per hit) — tool mode now renders the
 *  search-engine page above. */
export function renderSearchPage(root: string, query: string, result: KbSearchResult): string {
  if (!result.hits.length) {
    return `No notebook notes match "${query}". Fall through to \`coldstart find\` as usual.`;
  }
  const parts: string[] = [`# Notebook notes for: ${query}`, ''];
  for (const hit of result.hits) {
    const n = hit.note;
    const kind = n.type === 'lesson' && n.kind ? ` · ${n.kind}` : '';
    parts.push(`## ${n.title}  [${n.type}${kind} · ${n.status}]`);
    parts.push(`id: ${n.id} · updated ${n.updated.slice(0, 10)}`);
    if (n.status === 'superseded' && n.supersededBy) parts.push(`superseded by: ${n.supersededBy}`);
    if (n.aliases.length) parts.push(`aka: ${n.aliases.join(' · ')}`);
    for (const s of hit.stamped) parts.push(freshnessLine(s));
    if (hit.inactive) parts.push('[inactive — every anchored file is absent on this branch]');
    if (hit.absence) parts.push(hit.absence);
    parts.push('', noteBody(n), '');
  }
  parts.push('Anything marked [evidence changed] must be re-verified against the file before you rely on it.');
  return parts.join('\n');
}
