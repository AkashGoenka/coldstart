/**
 * kb write — the single write gate. The agent authors a JSON spec; this
 * validates it, enforces the TWO-PHASE reuse gate for flow/lesson concepts,
 * appends to the `.raw` log (which stamps ts + hashes), re-folds, and renders
 * the derived md.
 *
 * Two-phase (the id-stability answer): a flow/lesson spec arriving WITHOUT an
 * id first runs the note search on its own words. Any plausible matches →
 * exit "candidates": the agent must re-run with `--into <id>` (merge into the
 * existing concept) or `--new` (explicitly declare a new one). Unreliable
 * generation ("produce the identical string") becomes reliable matching
 * ("is this the same as one of these five?"). File notes skip the gate —
 * their id is derived from the path.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Facet, FileCharacter, FoldedNote, LessonKind, NewRecordInput, NoteType } from './types.js';
import { fileNoteId, coinId, isValidId } from './ids.js';
import { appendRecord, listIds } from './raw-log.js';
import { loadNote, loadAll, writeNoteMd, logMetric } from './store.js';
import { kbSearch } from './search.js';

const NOTE_TYPES = new Set(['file', 'flow', 'lesson']);
const LESSON_KINDS = new Set(['absence']);
const CHARACTERS = new Set(['hub', 'single']);

/** The agent-authored spec (JSON). Flat; unknown fields ride into the record.
 *  `type` also accepts the shorthands "file-hub" / "file-single" — sugar for
 *  type "file" + the character field (the log stores the canonical form so the
 *  tolerant reader's type set never grows). */
export interface WriteSpec {
  type?: NoteType | 'file-hub' | 'file-single';
  op?: 'put' | 'retract' | 'supersede';
  id?: string;
  /** File notes: the file the note is about (id + sole anchor derive from it). */
  path?: string;
  title?: string;
  aliases?: string[];
  anchors?: { path: string; symbols?: string[] }[];
  verified?: string[];
  summary?: string;
  character?: FileCharacter;
  facets?: unknown[];
  behaviors?: unknown[];
  features?: unknown[];
  steps?: unknown[];
  invariants?: string[];
  kind?: LessonKind;
  body?: string;
  scope?: { terms?: string[]; globs?: string[] };
  target?: { kind: string; key?: string };
  by?: string;
  [key: string]: unknown;
}

export interface WriteCandidate {
  id: string;
  type: string;
  title: string;
  summary: string;
}

export type WriteResult =
  | { status: 'written'; id: string; mdPath: string; op: string; warnings?: string[] }
  | { status: 'candidates'; candidates: WriteCandidate[]; message: string }
  | { status: 'error'; message: string };

export interface WriteOptions {
  /** Merge into this existing note id (phase-2 answer). */
  into?: string;
  /** Explicitly declare a new concept (phase-2 answer). */
  isNew?: boolean;
  /** Skip ALL candidate gates (fuzzy, exact-address, facet clash) and just
   *  write. Validation-run mode: duplicates are observable data. Structural
   *  validation (character, facet shape, ids) still applies. */
  force?: boolean;
  /** Session id for the capture-rate metric. */
  session?: string;
}

export async function kbWrite(root: string, spec: WriteSpec, opts: WriteOptions = {}): Promise<WriteResult> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return err('spec must be a JSON object');
  const op = spec.op ?? 'put';
  if (!['put', 'retract', 'supersede'].includes(op)) return err(`unknown op ${JSON.stringify(op)} — use put, retract, or supersede`);

  // "file-hub" / "file-single" are spec-level sugar; the log stores type "file"
  // + character (type is fold-immutable, character is a revisable judgment).
  let type = spec.type as NoteType | undefined;
  let character = spec.character;
  if (spec.type === 'file-hub' || spec.type === 'file-single') {
    const sugared: FileCharacter = spec.type === 'file-hub' ? 'hub' : 'single';
    if (character && character !== sugared) return err(`type "${spec.type}" conflicts with character "${character}"`);
    character = sugared;
    type = 'file';
  }
  if (!type || !NOTE_TYPES.has(type)) return err('spec needs a `type`: "file" (one real file — or shorthand "file-hub"/"file-single"), "flow" (a cross-file story), or "lesson" (a confirmed absence — "there is no X in this repo", with the search terms that proved it)');
  if (character !== undefined && !CHARACTERS.has(character)) return err('`character` must be "hub" (no single purpose — knowledge lives as symbol-keyed facets) or "single" (one purpose, one summary)');
  if (character !== undefined && type !== 'file') return err('`character` belongs to file notes');

  const facets = spec.facets as Facet[] | undefined;
  if (facets !== undefined) {
    if (type !== 'file') return err('`facets` belong to file notes — flows point at them via step symbols; lessons anchor to them');
    if (!Array.isArray(facets) || !facets.length) return err('`facets` must be a non-empty array');
    for (const f of facets) {
      if (!f || typeof f !== 'object' || typeof f.symbol !== 'string' || !f.symbol.trim() || typeof f.detail !== 'string' || !f.detail.trim()) {
        return err('each facet needs `symbol` (the top-level symbol it is about) and `detail` (+ optional `flows`: related flow-note ids)');
      }
    }
  }

  // ---- resolve the id -------------------------------------------------------
  let id = opts.into ?? spec.id;
  let freshlyCoined = false; // a coined id is created EXCLUSIVELY (see appendRecord)
  const existing = new Set(listIds(root));

  if (id !== undefined) {
    if (!isValidId(id)) return err(`invalid id ${JSON.stringify(id)}`);
    if ((opts.into || op !== 'put') && !existing.has(id)) return err(`no existing note ${id} — omit the id to create, or check \`kb status\``);
    if (existing.has(id)) {
      // A type-mismatched append would be skipped by the fold — reject it here.
      const { note: target } = loadNote(root, id);
      if (target && target.type !== type) {
        return err(`${id} is a ${target.type} note, but this spec says type ${type} — wrong target id?`);
      }
    }
  }

  if (type === 'file') {
    if (!spec.path) return err('a file note needs `path` — the file it is about');
    const derived = fileNoteId(spec.path);
    if (id && id !== derived) return err(`file-note ids are derived from the path (${derived}) — omit \`id\``);
    id = derived;
  } else if (op === 'put' && !id) {
    if (!spec.title || !String(spec.title).trim()) return err(`a new ${type} note needs a \`title\` (concept words a future agent would search with)`);
    // ---- the two-phase gate ----
    if (!opts.isNew && !opts.force) {
      if (type === 'lesson' && Array.isArray(spec.anchors) && spec.anchors.length) {
        // File-anchored facts dedup by EXACT (path, symbol) address — never by
        // fuzzy title overlap (title words are whatever this session happened
        // to choose; the address is stable).
        const candidates = exactAddressCandidates(root, spec.anchors);
        if (candidates.length) {
          return {
            status: 'candidates',
            candidates,
            message:
              'Existing knowledge at this exact (path, symbol) address. A lesson → re-run with `--into <id>` to reconcile into it. A file-note facet → the fact may belong there instead: re-submit as `{"type": "file-hub", "path": ..., "facets": [...]}` with `--into <file-note-id>`. Only if yours is a genuinely different fact, re-run with `--new`.',
          };
        }
      } else {
        const queryWords = [spec.title, ...(spec.aliases ?? []), spec.summary ?? ''].join(' ');
        const { hits } = await kbSearch(root, queryWords, { maxResults: 5, noMissLog: true });
        // Same-type only: a lesson about a flow's file always word-overlaps that
        // flow, but they are never the same concept — cross-type candidates would
        // gate every lesson (and merging a lesson --into a flow corrupts the log).
        const candidates = hits
          .filter((h) => h.note.type === type && h.note.status === 'active')
          .map((h) => ({
            id: h.note.id,
            type: h.note.type,
            title: h.note.title,
            summary: (h.note.summary ?? h.note.body ?? '').split('\n')[0].slice(0, 160),
          }));
        if (candidates.length) {
          return {
            status: 'candidates',
            candidates,
            message:
              'Existing notes may already cover this concept. If one of these IS your concept, re-run with `--into <id>` to merge into it (reconcile, don\'t duplicate). Only if none match, re-run with `--new`.',
          };
        }
      }
    }
    id = coinId(spec.title!, existing);
    freshlyCoined = true;
  }
  if (!id) return err(`op ${op} needs an \`id\` (which note to ${op})`);

  const current: FoldedNote | null = existing.has(id) ? loadNote(root, id).note : null;

  // ---- per-type validation (put only) --------------------------------------
  if (op === 'put') {
    if (type === 'file') {
      const effective = character ?? current?.character;
      if (!effective) return err('a file note needs `character` — "hub" (no single purpose; knowledge lives as symbol-keyed facets) or "single" (one purpose, one summary). Shorthand: `"type": "file-hub"` / `"file-single"`');
      if (facets && effective === 'single') return err('facets are for hub files — a single-purpose file carries one `summary`. If this file has outgrown one purpose, re-declare it: `"character": "hub"`');
      // ---- facet clash gate: replacing existing knowledge must be informed ----
      if (facets && current && !opts.into && !opts.force) {
        const clashes = facets.filter((f) => current.facets.some((x) => x.symbol === f.symbol));
        if (clashes.length) {
          return {
            status: 'candidates',
            candidates: clashes.map((f) => {
              const cur = current.facets.find((x) => x.symbol === f.symbol)!;
              return { id: id!, type: 'file', title: `${spec.path} :: ${cur.symbol}`, summary: cur.detail.split('\n')[0].slice(0, 160) };
            }),
            message:
              'A facet already exists at this symbol address (current knowledge shown above). If yours corrects or extends it, re-run with `--into <file-note-id>` — your detail replaces it, flow links union. If it is about something else, use a different symbol.',
          };
        }
      }
    }
    if (type === 'lesson') {
      if (!spec.kind || !LESSON_KINDS.has(spec.kind)) return err('a lesson needs `kind`: absence (the only lesson kind — a confirmed "there is no X", with the search that proved it)');
      if (spec.kind === 'absence' && !spec.scope?.terms?.length) return err('an absence lesson needs `scope.terms` — the search that proved the absence (freshness = re-running it)');
      if (!spec.body && !spec.id && !opts.into) return err('a lesson needs a `body` — when it applies + the actual truth');
    }
    if (type === 'flow' && !spec.id && !opts.into && !spec.steps?.length && !spec.summary) {
      return err('a flow note needs `steps` (the ordered cross-file story) or at least a `summary`');
    }
  } else if (op === 'retract' && (!spec.target || typeof spec.target !== 'object' || !spec.target.kind)) {
    return err('a retract needs `target`: {kind: behavior|feature|anchor|invariant|alias|note, key?}');
  } else if (op === 'supersede' && !spec.by) {
    return err('a supersede needs `by` — the id of the note that replaces this one');
  }

  // ---- facet flow-ref resolution (title → id; lexical, warn-never-reject) ---
  // Agents write flows and the file notes that back-link them in ONE chained
  // call, but a flow's coined id isn't predictable (collision suffix), so a
  // facet `flows` entry may be the flow's EXACT title instead. Resolution is
  // strictly lexical: exact id match first, else exact normalized-title match
  // against active flows — never fuzzy, so a wrong id can't be substituted.
  // Anything unresolvable (typo, ambiguous title, non-flow id) is kept AS
  // WRITTEN and warned about — same contract as pathWarnings: the note is
  // never lost over one bad link; the writing agent fixes it right now, and
  // lint flags whatever survives.
  const flowRefWarnings: string[] = [];
  if (op === 'put' && facets?.some((f) => f.flows?.length)) {
    const { notes } = loadAll(root);
    const active = notes.filter((n) => n.status === 'active');
    const byId = new Map(active.map((n) => [n.id, n]));
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const byTitle = new Map<string, FoldedNote[]>();
    for (const n of active) {
      if (n.type !== 'flow') continue;
      const k = norm(n.title);
      byTitle.set(k, [...(byTitle.get(k) ?? []), n]);
    }
    const resolved: Facet[] = [];
    for (const f of facets) {
      if (!f.flows?.length) { resolved.push(f); continue; }
      const out: string[] = [];
      for (const ref of f.flows) {
        const hit = byId.get(ref);
        if (hit) {
          out.push(ref);
          if (hit.type !== 'flow') flowRefWarnings.push(`facet "${f.symbol}": flows entry "${ref}" is a ${hit.type} note, not a flow — check the id`);
          continue;
        }
        const matches = byTitle.get(norm(ref)) ?? [];
        if (matches.length === 1) { out.push(matches[0].id); continue; }
        out.push(ref); // preserved as written — dangling beats lost
        flowRefWarnings.push(matches.length > 1
          ? `facet "${f.symbol}": flow title "${ref}" is ambiguous (${matches.map((m) => m.id).join(', ')}) — kept as written; replace with the id`
          : `facet "${f.symbol}": flows entry "${ref}" matches no flow id or exact flow title — kept as written (dangling); fix with the flow's printed id or exact title`);
      }
      resolved.push({ ...f, flows: out });
    }
    spec = { ...spec, facets: resolved };
  }

  // ---- build the record -----------------------------------------------------
  const { type: _t, op: _o, id: _i, path, ...rest } = spec;
  void _t; void _o; void _i;
  // The fold's tolerant reader validates payload shapes; the spec passes through.
  const record = { ...rest, id, type, op } as NewRecordInput;

  if (type === 'file' && op === 'put' && path) {
    // The file IS the anchor; the writer just deep-read it, so it counts verified.
    // Anchor symbols accumulate (union with what the note already knows +
    // facet symbols). The fold ALSO unions (concurrent writers each see stale
    // state); the write-side union just keeps each record self-contained.
    const symbols = [...new Set([
      ...(current?.anchors.find((a) => a.path === path)?.symbols ?? []),
      ...(Array.isArray(spec.anchors?.[0]?.symbols) ? spec.anchors[0].symbols : []),
      ...(facets?.map((f) => f.symbol) ?? []),
    ])];
    record.anchors = [{ path, ...(symbols.length ? { symbols } : {}) }];
    record.verified = [...new Set([path, ...(spec.verified ?? [])])];
    if (character) record.character = character; // sugar form ("file-hub") lands here
  }

  // A freshly-coined id is created with O_EXCL: two concurrent sessions can
  // coin the same id (both listed the dir before either created the file) and
  // would otherwise silently merge into one note. The loser lands on EEXIST,
  // marks the id taken, and re-coins — two same-moment captures of one concept
  // become a visible duplicate, never a silent merge.
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        appendRecord(root, record, { exclusive: freshlyCoined });
        break;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (!freshlyCoined || code !== 'EEXIST' || attempt >= 50) throw e;
        existing.add(id!);
        id = coinId(spec.title!, existing);
        record.id = id;
      }
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }

  const { note } = loadNote(root, id);
  if (!note) return err(`internal: ${id} folded to nothing after write`);
  const mdPath = writeNoteMd(root, note);
  logMetric(root, 'capture', { event: 'write', id, type, op, session: opts.session });
  const warnings = [...(op === 'put' ? pathWarnings(root, spec) : []), ...flowRefWarnings];
  return { status: 'written', id, mdPath, op, ...(warnings.length ? { warnings } : {}) };
}

/** Flag step/anchor paths that don't exist on disk — the flow→file join is a
 *  static path string, so a typo'd path is a silently dangling link. Warn,
 *  never reject: the writing agent is best placed to fix it right now, and a
 *  legitimately deleted file is the agent's call to record. */
function pathWarnings(root: string, spec: WriteSpec): string[] {
  const out: string[] = [];
  const check = (p: unknown, where: string): void => {
    if (typeof p !== 'string' || !p) return;
    if (isAbsolute(p)) { out.push(`${where} "${p}" is absolute — use a repo-relative path (links join on the exact string)`); return; }
    if (!existsSync(join(root, p))) out.push(`${where} "${p}" not found on disk — dangling link unless the path is fixed`);
  };
  check(spec.path, 'path');
  for (const a of spec.anchors ?? []) check((a as { path?: unknown })?.path, 'anchor');
  for (const s of (spec.steps ?? []) as { path?: unknown }[]) check(s?.path, 'step');
  return out;
}

function err(message: string): WriteResult {
  return { status: 'error', message };
}

/**
 * Exact (path, symbol) dedup for anchored lessons — the S2 walk: "what do we
 * know about models.py::LoadStaging?" resolves by address, never by title
 * words. Same-granularity matching keeps it exact: a symbol-level spec matches
 * symbol-level lessons (overlap) plus the file note's facets at those symbols;
 * a file-level spec (no symbols) matches file-level lessons on the same path.
 */
function exactAddressCandidates(
  root: string,
  anchors: { path: string; symbols?: string[] }[],
): WriteCandidate[] {
  const out: WriteCandidate[] = [];
  const seen = new Set<string>();
  const { notes } = loadAll(root);
  for (const spec of anchors) {
    if (!spec || typeof spec.path !== 'string' || !spec.path) continue;
    const symbols = Array.isArray(spec.symbols) ? spec.symbols.filter((s) => typeof s === 'string') : [];
    for (const n of notes) {
      if (n.status !== 'active' || n.type !== 'lesson') continue;
      const hit = n.anchors.some((a) => a.path === spec.path && (symbols.length
        ? (a.symbols ?? []).some((s) => symbols.includes(s))
        : !a.symbols?.length));
      if (hit && !seen.has(n.id)) {
        seen.add(n.id);
        out.push({ id: n.id, type: 'lesson', title: n.title, summary: (n.body ?? '').split('\n')[0].slice(0, 160) });
      }
    }
    if (symbols.length) {
      const fnote = notes.find((n) => n.id === fileNoteId(spec.path) && n.status === 'active');
      for (const f of fnote?.facets ?? []) {
        if (!symbols.includes(f.symbol)) continue;
        const key = `${fnote!.id}::${f.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: fnote!.id, type: 'file', title: `${spec.path} :: ${f.symbol}`, summary: f.detail.split('\n')[0].slice(0, 160) });
      }
    }
  }
  return out;
}
