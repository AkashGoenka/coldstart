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
import type { LessonKind, NewRecordInput, NoteType } from './types.js';
import { fileNoteId, coinId, isValidId } from './ids.js';
import { appendRecord, listIds } from './raw-log.js';
import { loadNote, writeNoteMd, logMetric } from './store.js';
import { kbSearch } from './search.js';

const NOTE_TYPES = new Set(['file', 'flow', 'lesson']);
const LESSON_KINDS = new Set(['trap', 'rule', 'bug-cause', 'rationale', 'absence']);

/** The agent-authored spec (JSON). Flat; unknown fields ride into the record. */
export interface WriteSpec {
  type?: NoteType;
  op?: 'put' | 'retract' | 'supersede';
  id?: string;
  /** File notes: the file the note is about (id + sole anchor derive from it). */
  path?: string;
  title?: string;
  aliases?: string[];
  anchors?: { path: string; symbols?: string[] }[];
  verified?: string[];
  summary?: string;
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
  | { status: 'written'; id: string; mdPath: string; op: string }
  | { status: 'candidates'; candidates: WriteCandidate[]; message: string }
  | { status: 'error'; message: string };

export interface WriteOptions {
  /** Merge into this existing note id (phase-2 answer). */
  into?: string;
  /** Explicitly declare a new concept (phase-2 answer). */
  isNew?: boolean;
  /** Session id for the capture-rate metric. */
  session?: string;
}

export async function kbWrite(root: string, spec: WriteSpec, opts: WriteOptions = {}): Promise<WriteResult> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return err('spec must be a JSON object');
  const op = spec.op ?? 'put';
  if (!['put', 'retract', 'supersede'].includes(op)) return err(`unknown op ${JSON.stringify(op)} — use put, retract, or supersede`);

  const type = spec.type;
  if (!type || !NOTE_TYPES.has(type)) return err('spec needs a `type`: "file" (one real file), "flow" (a cross-file story), or "lesson" (a trap/rule/bug-cause/rationale/absence)');

  // ---- resolve the id -------------------------------------------------------
  let id = opts.into ?? spec.id;
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
    if (!opts.isNew) {
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
    id = coinId(spec.title!, existing);
  }
  if (!id) return err(`op ${op} needs an \`id\` (which note to ${op})`);

  // ---- per-type validation (put only) --------------------------------------
  if (op === 'put') {
    if (type === 'lesson') {
      if (!spec.kind || !LESSON_KINDS.has(spec.kind)) return err('a lesson needs `kind`: trap | rule | bug-cause | rationale | absence');
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

  // ---- build the record -----------------------------------------------------
  const { type: _t, op: _o, id: _i, path, ...rest } = spec;
  void _t; void _o; void _i;
  // The fold's tolerant reader validates payload shapes; the spec passes through.
  const record = { ...rest, id, type, op } as NewRecordInput;

  if (type === 'file' && op === 'put' && path) {
    // The file IS the anchor; the writer just deep-read it, so it counts verified.
    record.anchors = [{ path, ...(Array.isArray(spec.anchors?.[0]?.symbols) ? { symbols: spec.anchors[0].symbols } : {}) }];
    record.verified = [...new Set([path, ...(spec.verified ?? [])])];
  }

  try {
    appendRecord(root, record);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }

  const { note } = loadNote(root, id);
  if (!note) return err(`internal: ${id} folded to nothing after write`);
  const mdPath = writeNoteMd(root, note);
  logMetric(root, 'capture', { event: 'write', id, type, op, session: opts.session });
  return { status: 'written', id, mdPath, op };
}

function err(message: string): WriteResult {
  return { status: 'error', message };
}
