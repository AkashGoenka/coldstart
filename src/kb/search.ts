/**
 * kb search — the 3rd core tool. A cold agent arrives with WORDS, no filenames;
 * this is tried before `find`.
 *
 * Lane 1 (words→notes): BM25 over each note's title, prose and
 * addresses (anchor paths + symbols), with code-shaped words split into their
 * parts on both sides (kbElicit ≡ kb-elicit ≡ "kb elicit"). Search aliases are
 * not read. Hook mode (recall) shows the top notes only when the best one leads
 * the runner-up by HOOK_MIN_MARGIN; the agent picks among them.
 * Lane 2 (code→notes, tool mode): a query word that IS a symbol declared in an
 * anchored file surfaces the note even when the note never stored the symbol —
 * resolved via the keeper-maintained notes index (per-anchor symbol
 * inventories), never by scanning the code index here (C1 decoupling).
 *
 * Results carry freshness computed NOW (never trusted from write time);
 * absence notes print the keeper's re-run verdict stamp. Freshness is a LABEL,
 * not a rank: only withdrawn notes (status) and notes whose subject is gone
 * from this branch (inactive) are hard-tiered below score.
 *
 * Every zero-hit query is appended to the miss-log — the alias bet's failure
 * mode is SILENT (the agent just falls through to `find`), so the miss-log is
 * the health metric and the future source of real aliases.
 */
import type { FoldedNote, StampedAnchor } from './types.js';
import { stampCoversTerms, type KbNotesIndex } from './notes-index.js';
import { stampAnchors, freshnessLine, anchorsAllMissing } from './freshness.js';
import { loadAll, logMetric } from './store.js';
import { NOTES_REL } from './raw-log.js';
import { renderNote } from './render.js';

export interface KbSearchOptions {
  /** Keeper-maintained notes index for lane 2 (tool mode), absence stamps, and
   *  the rename overlay. Load via loadKbNotesIndex(root) — a plain sidecar
   *  read, safe in hook mode too. Omit → those channels degrade. */
  notesIndex?: KbNotesIndex | null;
  maxResults?: number;
  /** Where the query came from — recorded in the miss-log. */
  source?: 'tool' | 'hook';
  /** Suppress miss-log writes (used by write-time candidate matching). */
  noMissLog?: boolean;
  /**
   * Recall-hook mode, whose "query" is an arbitrary user sentence: score title
   * + prose only (no anchors, no lane 2), keep only active notes whose subject
   * exists on this branch, and show the page only when the top note leads the
   * runner-up by HOOK_MIN_MARGIN. Explicit tool calls get every note, ranked.
   */
  strongOnly?: boolean;
  /**
   * Note ids already injected earlier in THIS session — dropped from the
   * final page. Recall re-showed the same note inside one session on 61% of
   * injections (worst: 12×), which is pure tax: the agent already has the
   * title and gist in context. Applied AFTER ranking, so a suppressed repeat
   * does NOT get backfilled by a lower-ranked note — the page just shrinks
   * (and an all-seen page injects nothing). Hook-side bookkeeping, so tool
   * `kb search` is unaffected.
   */
  excludeIds?: ReadonlySet<string>;
}

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
  /** Query tokens that matched this note — recorded so the injection log can
   *  be analyzed after the fact (which words did the work is not recoverable
   *  from the query string alone). */
  carriers: string[];
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

const squash = (s: string): string => s.toLowerCase().replace(/[-_/.\s]+/g, '');

// ---- Tokenizer ----------------------------------------------------------------
// Code-shaped words are split into the English words they are made of BEFORE
// lowercasing loses the boundaries: finalizeBatchCoverage → finalize batch
// coverage, kb_write → kb write, src/kb/write-batch.ts → src kb write batch ts.
// Plain English passes through. The SAME tokenizer runs on the query and the
// note, so `kb-elicit` in a prompt meets `hooks/kb-elicit.mjs` in an anchor.
const IDENT = /[A-Za-z0-9_$~][A-Za-z0-9_$.\/\-~]*[A-Za-z0-9_$]|[A-Za-z0-9]/g;
const splitWord = (w: string): string => w
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/[_$.\/\-~]+/g, ' ');
const splitIdentifiers = (text: string): string => text.replace(IDENT, (w) =>
  /[a-z0-9][A-Z]|[A-Z]{2,}[a-z]|[_$\/~]|\w[.\-]\w/.test(w) ? splitWord(w) : w);
/** Glue words dropped from query AND note. Deliberately SMALL: on 80 labelled
 *  prompts, adding intent words (want/need/use/make/new/let…) cut the hook's
 *  right-note pages from 23/36 to 16/36 — idf already discounts common words,
 *  and dropping them outright also removes the ones that separate two notes. */
const QUERY_STOP = new Set(
  'the a an and or of to in on for is it this that be with as at by from are was we i you do does not can if so what how why when which there their they them our my me pls please just'.split(' '),
);
export function tokenize(text: string): string[] {
  return splitIdentifiers(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !QUERY_STOP.has(w));
}

/** Everything a note says, as one BM25 document: title, prose (summary/body,
 *  facet details, behaviors, features, steps, invariants, lesson scope terms)
 *  and — in tool mode — its addresses (anchor paths + symbols): agents search
 *  by identifier, and these are the only place a note's identifiers live. Hook
 *  mode leaves them out: its query is a prose prompt, and on 80 labelled
 *  prompts the extra length cost the hook 23 → 21 right-note pages and 27 → 24
 *  correct silences. A prompt that literally names a file still reaches its
 *  note through the path-name override.
 *  Search aliases are deliberately NOT read: on 150 notes / 80 labelled
 *  prompts they ranked no better (17 vs 18 top-1 of 36) and gated worse (46 vs
 *  50 of 80) — they add matching surface for ordinary words, which is how wrong
 *  notes get injected. */
function noteDoc(note: FoldedNote, withAnchors: boolean): string {
  return [
    note.title,
    note.summary ?? '',
    note.body ?? '',
    ...note.facets.map((f) => `${f.symbol} ${f.detail}`),
    ...note.behaviors.map((b) => `${b.concept_id} ${(b.symbols ?? []).join(' ')} ${b.detail}`),
    ...note.features.map((f) => `${f.concept_id} ${f.role}`),
    ...note.steps.map((s) => `${s.path} ${(s.symbols ?? []).join(' ')} ${s.role}`),
    ...note.invariants,
    ...(note.scope?.terms ?? []),
    ...(withAnchors ? note.anchors.map((a) => [a.path, ...(a.symbols ?? [])].join(' ')) : []),
  ].join('\n');
}

// ---- Scoring -----------------------------------------------------------------
// Okapi BM25 over the note corpus: rare terms discriminate (idf), repeats
// saturate (k1), long notes stop winning on vocabulary volume (b).
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Results-page relevance floor: a hit scoring below this fraction of the top
 *  hit is a graze, not an answer. Two uses, one constant: renderResultsPage
 *  drops sub-floor hits from the page, and kbSearch counts cap-omitted hits
 *  ABOVE it to decide whether the --max footer is worth showing (a floor-only
 *  tail isn't — widening would surface nothing new). */
const RESULTS_FLOOR = 0.25;

/** Hook mode (recall): show the top notes only when the best one beats the
 *  runner-up by at least this many BM25 points; otherwise stay silent. One
 *  point is roughly one moderately rare word the runner-up lacks. Measured on
 *  80 labelled prompts (36 with a right note, 44 without), top-3 page: margin
 *  ≥ 1 showed the right note on 23/36 and stayed correctly silent on 27/44.
 *  Larger margins trade recall for silence (≥ 3: 14/36, 37/44). The agent
 *  picks among the page, so recall is preferred over a stricter gate. */
const HOOK_MIN_MARGIN = 1;
/** Young notebooks are exempt from the margin gate: idf is tiny when
 *  there are few notes (one note: a perfect two-word match scores ~0.6), so a
 *  fixed margin would silence every prompt until the notebook grew. Below this
 *  size any match is shown — a weak page costs a glance, not a poisoning. */
const HOOK_GATE_MIN_NOTES = 30;

/** Path-name override: when the raw prompt literally contains a note's anchor
 *  path (case/separator-insensitive), the user named that file — surface its
 *  note and let it lead. The anchor-path squash must be ≥ this many chars to
 *  fire, so trivially short paths can't graze arbitrary prose. */
const PATH_MATCH_MIN_SQUASH = 6;
const PATH_MATCH_BOOST = 100;

/** Lane 2 (tool mode): a query word that IS a symbol declared in a note's
 *  anchored file (per the keeper's per-anchor inventory) finds that note even
 *  when the note never wrote the symbol down. Whole-symbol, case-insensitive
 *  equality only — a substring or a split fragment would let ordinary words
 *  ("but", "see") resolve to unrelated identifiers. Each token of the symbol
 *  counts as one occurrence in the note. Hook mode never uses it: a prompt
 *  sharing one symbol with a hub file is a graze. */
function laneTwoTokens(kb: KbNotesIndex, query: string, anchorPaths: string[]): string[] {
  const words = new Set((query.match(IDENT) ?? []).map((w) => w.toLowerCase()));
  const out: string[] = [];
  for (const p of anchorPaths) {
    for (const s of kb.anchors[p] ?? []) if (words.has(s.toLowerCase())) out.push(...tokenize(s));
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
  const qTokens = [...new Set(tokenize(query))];
  const terms = qTokens;
  // Path-name override (recall only): the raw prompt literally naming a note's
  // anchor path surfaces that note even when the words alone would not.
  const querySquash = squash(query);
  const pathNamedIds = new Set<string>();
  if (opts.strongOnly) {
    for (const note of notes) {
      if (note.anchors.some((a) => { const ps = squash(a.path); return ps.length >= PATH_MATCH_MIN_SQUASH && querySquash.includes(ps); })) {
        pathNamedIds.add(note.id);
      }
    }
  }
  if (!notes.length || (!qTokens.length && !pathNamedIds.size)) {
    if (notes.length && !opts.noMissLog) logMetric(root, 'miss-log', { query, source: opts.source ?? 'tool', reason: 'no-terms' });
    return { hits: [], terms, warnings };
  }

  // Term frequencies per note (+ lane-2 symbol tokens in tool mode), then score.
  const tfs = notes.map((note) => {
    const toks = tokenize(noteDoc(note, !opts.strongOnly));
    const len = toks.length;
    if (!opts.strongOnly && opts.notesIndex) toks.push(...laneTwoTokens(opts.notesIndex, query, note.anchors.map((a) => a.path)));
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, len };
  });
  const avgLen = Math.max(1, tfs.reduce((a, d) => a + d.len, 0) / tfs.length);
  const df = new Map<string, number>();
  for (const t of qTokens) df.set(t, tfs.filter((d) => d.tf.has(t)).length);
  const N = notes.length;

  const scored: { note: FoldedNote; score: number; carriers: string[] }[] = [];
  for (let i = 0; i < N; i++) {
    const { tf, len } = tfs[i];
    let score = 0;
    const carriers: string[] = [];
    for (const t of qTokens) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * len) / avgLen));
      carriers.push(t);
    }
    if (pathNamedIds.has(notes[i].id)) { score += PATH_MATCH_BOOST; carriers.push('<path>'); }
    if (score > 0) scored.push({ note: notes[i], score, carriers });
  }

  if (!scored.length) {
    if (!opts.noMissLog) logMetric(root, 'miss-log', { query, terms, source: opts.source ?? 'tool' });
    return { hits: [], terms, warnings };
  }

  // Freshness NOW for everything scored (never trusted from write time). It is
  // LABELLED, never ranked — see the tier comment below.
  const withTier: KbSearchHit[] = scored.map(({ note, score, carriers }) => {
    // The keeper's rename overlay lets a note whose file was renamed resolve to
    // its new path ('moved', not 'missing'), so a byte-exact refactor doesn't
    // send the note inactive. Live-re-verified inside stampAnchors.
    const stamped = stampAnchors(root, note.anchors, opts.notesIndex?.renames);
    // Lessons are exempt (an absence lesson is ABOUT non-existence); any other
    // note whose anchored files are all gone is inactive on this branch.
    const inactive = note.type !== 'lesson' && anchorsAllMissing(stamped);
    // Tiers rank CLAIMS, not evidence age: the note's subject is gone from this
    // branch (inactive), or its author withdrew it (status). Anchor drift does
    // NOT tier — "changed" means UNVERIFIED, not wrong; the `[evidence changed]`
    // label carries it. (Staleness was a tier until 2026-07-30 and buried the
    // top-scoring note on 50% of 249 logged prompts, flow notes worst.)
    const tier = inactive ? 2 : note.status !== 'active' ? 1 : 0;
    return { note, score, tier, inactive, stamped, absence: absenceVerdict(note, opts.notesIndex), carriers };
  });
  // Recall (hook mode) never injects a note whose subject doesn't exist on this
  // branch, nor a withdrawn one. Tool search keeps both (bottom tiers, labelled).
  const surfaced = opts.strongOnly ? withTier.filter((h) => h.tier === 0) : withTier;
  surfaced.sort((a, b) => a.tier - b.tier || b.score - a.score || (a.note.id < b.note.id ? -1 : 1));

  // Hook-mode gate: silent unless the best note clearly leads. See HOOK_MIN_MARGIN.
  if (opts.strongOnly && surfaced.length && N >= HOOK_GATE_MIN_NOTES) {
    const margin = surfaced[0].score - (surfaced[1]?.score ?? 0);
    if (margin < HOOK_MIN_MARGIN) {
      if (!opts.noMissLog) logMetric(root, 'inject-log', { query: query.slice(0, 200), suppressed: true, top: surfaced[0].note.id, score: Math.round(surfaced[0].score * 10) / 10, margin: Math.round(margin * 100) / 100, carriers: surfaced[0].carriers });
      return { hits: [], terms, warnings };
    }
  }

  // Hits the cap dropped that still clear the results floor — a genuine second
  // page. The footer offers --max only when this is non-zero.
  const top = surfaced[0]?.score ?? 0;
  const omitted = surfaced.slice(max).filter((h) => h.score >= RESULTS_FLOOR * top).length;

  // Session dedup runs LAST, on the page we would actually have shown, so a
  // suppressed repeat frees no slot: the page shrinks (all-seen → inject
  // nothing) instead of pulling up a note the cap had already rejected.
  const page = surfaced.slice(0, max);
  const deduped = opts.excludeIds?.size
    ? page.filter((h) => !opts.excludeIds!.has(h.note.id))
    : page;

  return { hits: deduped, terms, warnings, omitted, maxUsed: max };
}

/** Body section of the rendered md (frontmatter stripped) for inlining. */
function noteBody(note: FoldedNote): string {
  const md = renderNote(note);
  const end = md.indexOf('\n---\n', 3);
  return end >= 0 ? md.slice(end + 5).trim() : md.trim();
}

/** Which file a note is about, when its title no longer says so.
 *
 *  A file note's title defaults to its anchor path (fold.ts), so historically
 *  the path was always on the line. Once notes carry a natural-language title
 *  — which is the only way a prompt can reach them, since prose is scored but
 *  cannot admit a match — a fresh note would otherwise never show its subject
 *  anywhere: the freshness stamp only names paths when they changed or moved. */
const subjectPath = (n: FoldedNote): string =>
  n.type === 'file' && n.anchors[0] && n.anchors[0].path !== n.title ? ` · ${n.anchors[0].path}` : '';

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
  const lines = [`- **${n.title}**  [${n.type}${kind}${subjectPath(n)}${status}]${fresh}`];
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
 *  is one Read of the open: path. Injected context is re-read every turn, so the
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
    parts.push(`${i + 1}. ${n.title}  [${n.type}${kind}${subjectPath(n)} · ${fresh} · ${n.updated.slice(0, 10)}]`);
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
    const allAliases = [...n.identityAliases, ...n.incidentAliases];
    if (allAliases.length) parts.push(`aka: ${allAliases.join(' · ')}`);
    for (const s of hit.stamped) parts.push(freshnessLine(s));
    if (hit.inactive) parts.push('[inactive — every anchored file is absent on this branch]');
    if (hit.absence) parts.push(hit.absence);
    parts.push('', noteBody(n), '');
  }
  parts.push('Anything marked [evidence changed] must be re-verified against the file before you rely on it.');
  return parts.join('\n');
}
