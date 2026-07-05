/**
 * kb search — the 3rd core tool. A cold agent arrives with WORDS, no filenames;
 * this is tried before `find`.
 *
 * Lane 1 (words→notes): task words vs title/aliases (weight 3), anchor
 * paths+symbols (weight 2), prose (weight 1) — coverage × idf over the NOTE
 * corpus, the same ranking shape as `find` over a different corpus.
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
import { stampAnchors, freshnessLine } from './freshness.js';
import { loadAll, logMetric } from './store.js';
import { renderNote } from './render.js';

export interface KbSearchOptions {
  /** Keeper-maintained notes index for lane 2 + absence stamps. Omit (hook
   *  mode) to skip both. Load via loadKbNotesIndex(root). */
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
  /** 0 = active+all-anchors-fresh · 1 = active but stale · 2 = superseded/retracted */
  tier: number;
  stamped: StampedAnchor[];
  /** Absence-note re-run verdict line, when applicable. */
  absence?: string;
}

export interface KbSearchResult {
  hits: KbSearchHit[];
  terms: string[];
  warnings: string[];
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
  const anchor = note.anchors.map((a) => [a.path, ...(a.symbols ?? [])].join(' ')).join(' ');
  const body = [
    note.summary ?? '',
    note.body ?? '',
    ...note.behaviors.map((b) => `${b.concept_id} ${(b.symbols ?? []).join(' ')} ${b.detail}`),
    ...note.features.map((f) => `${f.concept_id} ${f.role}`),
    ...note.steps.map((s) => `${s.path} ${(s.symbols ?? []).join(' ')} ${s.role}`),
    ...note.invariants,
    ...(note.scope?.terms ?? []),
  ].join(' ');
  return { name: norm(name), nameSquash: squash(name), nameRaw: name, anchor: norm(anchor), anchorSquash: squash(anchor), body: norm(body) };
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
  if (!notes.length || !terms.length) {
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
  const maxIdf = Math.max(1e-9, ...terms.map((_, k) => idf(k)));

  const scored: { note: FoldedNote; score: number }[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const h = stacks[i];
    let covered = 0;
    let boost = 0;
    let strong = false;
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k];
      const inName = hits(h.name, h.nameSquash, t);
      let inAnchor = hits(h.anchor, h.anchorSquash, t);
      if (!inAnchor && termFiles.get(t)?.size) {
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
      if (inName || inAnchor) strong = true;
      boost += ((inName ? 3 : 0) + (inAnchor ? 2 : 0) + (inBody ? 1 : 0)) * idf(k);
    }
    if (!covered) continue;
    if (opts.strongOnly && !strong) continue; // body-word coverage ≠ a hit on an arbitrary sentence
    // Hook mode scores by idf-weighted channel boost alone: a rare-name match
    // ("principaluser") must dominate common-verb grazes ("save", "files") that
    // raw coverage counts as equals.
    scored.push({ note, score: opts.strongOnly ? boost : covered * 3 + boost / maxIdf });
  }

  if (!scored.length) {
    if (!opts.noMissLog) logMetric(root, 'miss-log', { query, terms, source: opts.source ?? 'tool' });
    return { hits: [], terms, warnings };
  }

  // Freshness NOW for everything scored, then hard-tier: fresh+active first.
  const withTier: KbSearchHit[] = scored.map(({ note, score }) => {
    const stamped = stampAnchors(root, note.anchors);
    const stale = stamped.some((s) => s.state === 'changed' || s.state === 'missing');
    const tier = note.status !== 'active' ? 2 : stale ? 1 : 0;
    return { note, score, tier, stamped, absence: absenceVerdict(note, opts.notesIndex) };
  });
  withTier.sort((a, b) => a.tier - b.tier || b.score - a.score || (a.note.id < b.note.id ? -1 : 1));

  // Hook mode: hits far below the best are padding (a generic path segment
  // grazing an anchor), not a second answer — don't inject them.
  const trimmed = opts.strongOnly && withTier.length > 1
    ? withTier.filter((h) => h.score >= 0.4 * withTier[0].score)
    : withTier;

  return { hits: trimmed.slice(0, max), terms, warnings };
}

/** Body section of the rendered md (frontmatter stripped) for inlining. */
function noteBody(note: FoldedNote): string {
  const md = renderNote(note);
  const end = md.indexOf('\n---\n', 3);
  return end >= 0 ? md.slice(end + 5).trim() : md.trim();
}

/** Hook-mode page: title + one-line gist + aggregated freshness per note — a
 *  scent trail, not the notes themselves. The agent pulls a full note with
 *  `kb search <title words>` when a title matches its task. Kept small on
 *  purpose: injected context is re-read on every turn of the session, and
 *  >10KB hook payloads get spilled to a pointer file agents mostly ignore. */
export function renderCompactPage(query: string, result: KbSearchResult): string {
  if (!result.hits.length) {
    return `No notebook notes match "${query}". Fall through to \`coldstart find\` as usual.`;
  }
  const lines: string[] = [];
  for (const hit of result.hits) {
    const n = hit.note;
    const kind = n.type === 'lesson' && n.kind ? `/${n.kind}` : '';
    const status = n.status !== 'active' ? ` · ${n.status.toUpperCase()}` : '';
    const changed = hit.stamped.filter((s) => s.state === 'changed' || s.state === 'missing');
    const fresh =
      !hit.stamped.length ? '' :
      changed.length ? ` · [evidence changed: ${changed.slice(0, 2).map((s) => s.path).join(', ')}${changed.length > 2 ? ` +${changed.length - 2}` : ''}]` :
      hit.stamped.every((s) => s.state === 'fresh') ? ' · anchors [fresh]' : ' · [not fully verified]';
    const gistSrc = (n.summary || n.body || n.invariants[0] || '').replace(/\s+/g, ' ').trim();
    lines.push(`- **${n.title}**  [${n.type}${kind}${status}]${fresh}`);
    if (gistSrc) lines.push(`  ${gistSrc.slice(0, 220)}${gistSrc.length > 220 ? '…' : ''}`);
    if (hit.absence) lines.push(`  ${hit.absence}`);
  }
  return lines.join('\n');
}

/** The agent-facing page: enough inlined that no second call is needed. */
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
    if (hit.absence) parts.push(hit.absence);
    parts.push('', noteBody(n), '');
  }
  parts.push('Anything marked [evidence changed] must be re-verified against the file before you rely on it.');
  return parts.join('\n');
}
