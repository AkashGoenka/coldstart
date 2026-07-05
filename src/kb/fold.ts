/**
 * The fold — render is a fold, and the fold IS the merge.
 *
 * A note's content is a pure function of its `.raw` log: sort all records by
 * `ts` (tie-broken by canonical-JSON compare so git-union interleave order is
 * irrelevant), then fold left through merge-by-id. Same operation for a
 * same-branch append and a cross-branch git merge — there is no separate merge
 * algorithm.
 *
 * Per-field rules (docs/notebook-kb-implementation-plan.md §3):
 *   title/summary/kind/body/scope  last-writer-wins
 *   aliases/invariants             union by exact text (retractable)
 *   behaviors                      keyed by concept_id: replace match, keep rest
 *   features                       union by concept_id, later role wins
 *   anchors                        union by path; hash updated only by records
 *                                  that carry one (i.e. verified at append time)
 *   steps                          last-writer-wins whole array (ordered story)
 *   unknown fields                 shallow LWW into `extra`, preserved
 *
 * Ordered-fold tombstone semantics: retract removes what earlier puts added; a
 * LATER put legitimately re-adds (an agent re-learned it). A full-note retract
 * is revived by a later put; a supersede is sticky (re-stamping an anchor of a
 * superseded note must not resurrect it).
 *
 * Tolerant reader: structurally-invalid records, unknown ops, and records from
 * a newer major (`v > 1`) are skipped with a warning — never a hard error.
 */
import type {
  Anchor, Behavior, Feature, FlowStep, FoldedNote, LessonKind, NoteType, RetractTarget,
} from './types.js';
import { KB_RAW_VERSION } from './raw-log.js';

const ENVELOPE_KEYS = new Set(['v', 'ts', 'id', 'type', 'op']);
const PUT_KEYS = new Set([
  'title', 'aliases', 'anchors', 'verified', 'summary', 'behaviors', 'features',
  'steps', 'invariants', 'kind', 'body', 'scope',
]);
const OP_KEYS = new Set(['target', 'by']);
const NOTE_TYPES = new Set<string>(['file', 'flow', 'lesson']);
const OPS = new Set<string>(['put', 'retract', 'supersede']);
const LESSON_KINDS = new Set<string>(['trap', 'rule', 'bug-cause', 'rationale', 'absence']);

/** Canonical JSON (recursively key-sorted) — the deterministic ts tie-breaker. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export interface FoldResult {
  /** null when the log holds no applicable records. */
  note: FoldedNote | null;
  warnings: string[];
}

interface Rec {
  [key: string]: unknown;
  v?: unknown; ts?: unknown; id?: unknown; type?: unknown; op?: unknown;
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const strArr = (x: unknown): string[] => (Array.isArray(x) ? x.filter(isStr) : []);

export function fold(id: string, rawRecords: unknown[]): FoldResult {
  const warnings: string[] = [];

  // ---- validate + order -----------------------------------------------------
  const usable: { ts: string; key: string; rec: Rec }[] = [];
  for (let i = 0; i < rawRecords.length; i++) {
    const rec = rawRecords[i] as Rec;
    const at = `${id} record ${i + 1}`;
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { warnings.push(`${at}: not an object — skipped`); continue; }
    if (typeof rec.v !== 'number') { warnings.push(`${at}: missing v — skipped`); continue; }
    if (rec.v > KB_RAW_VERSION) { warnings.push(`${at}: v${rec.v} is from a newer coldstart — skipped (run kb migrate after upgrading)`); continue; }
    if (!isStr(rec.ts)) { warnings.push(`${at}: missing ts — skipped`); continue; }
    if (!isStr(rec.op) || !OPS.has(rec.op)) { warnings.push(`${at}: unknown op ${JSON.stringify(rec.op)} — skipped`); continue; }
    if (isStr(rec.id) && rec.id !== id) { warnings.push(`${at}: id ${rec.id} does not match log ${id} — skipped`); continue; }
    if (!isStr(rec.type) || !NOTE_TYPES.has(rec.type)) { warnings.push(`${at}: unknown type ${JSON.stringify(rec.type)} — skipped`); continue; }
    usable.push({ ts: rec.ts, key: stableStringify(rec), rec });
  }
  usable.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (!usable.length) return { note: null, warnings };

  // ---- fold state -----------------------------------------------------------
  const type = usable[0].rec.type as NoteType;
  const note: FoldedNote = {
    id, type,
    title: '', aliases: [], anchors: [],
    status: 'active', updated: usable[0].ts, edits: 0,
    behaviors: [], features: [], steps: [], invariants: [],
    extra: {},
  };

  for (const { ts, rec } of usable) {
    if ((rec.type as string) !== type) {
      warnings.push(`${id}: type changed ${type}→${rec.type} at ${ts} — record skipped (type is immutable)`);
      continue;
    }
    const op = rec.op as string;
    if (op === 'put') applyPut(note, rec, warnings);
    else if (op === 'retract') { if (!applyRetract(note, rec, warnings, `${id} @ ${ts}`)) continue; }
    else if (op === 'supersede') {
      if (!isStr(rec.by)) { warnings.push(`${id} @ ${ts}: supersede without "by" — skipped`); continue; }
      note.status = 'superseded';
      note.supersededBy = rec.by;
    }
    note.edits++;
    if (ts > note.updated) note.updated = ts;
  }

  if (!note.title) {
    note.title = type === 'file' && note.anchors[0] ? note.anchors[0].path : id;
  }
  return { note, warnings };
}

function applyPut(note: FoldedNote, rec: Rec, warnings: string[]): void {
  // A put revives a retracted note (agent re-learned it); a supersede is sticky.
  if (note.status === 'retracted') { note.status = 'active'; }

  if (isStr(rec.title) && rec.title.trim()) {
    const incoming = rec.title.trim();
    // A replaced title stays searchable: demote the old one to an alias.
    // (Titles are retrieval keys; --into merges must not erase them.)
    if (note.title && note.title !== incoming && !note.aliases.includes(note.title)) {
      note.aliases.push(note.title);
    }
    note.title = incoming;
  }
  for (const a of strArr(rec.aliases)) if (!note.aliases.includes(a)) note.aliases.push(a);
  if (isStr(rec.summary)) note.summary = rec.summary;
  if (isStr(rec.body)) note.body = rec.body;
  if (isStr(rec.kind)) {
    if (LESSON_KINDS.has(rec.kind)) note.kind = rec.kind as LessonKind;
    else warnings.push(`${note.id}: unknown lesson kind ${JSON.stringify(rec.kind)} — kept previous`);
  }
  if (rec.scope && typeof rec.scope === 'object') {
    const s = rec.scope as { terms?: unknown; globs?: unknown };
    note.scope = { terms: strArr(s.terms), ...(Array.isArray(s.globs) ? { globs: strArr(s.globs) } : {}) };
  }

  if (Array.isArray(rec.anchors)) {
    for (const raw of rec.anchors) {
      if (!raw || typeof raw !== 'object' || !isStr((raw as Anchor).path)) continue;
      const inc = raw as Anchor;
      const existing = note.anchors.find((a) => a.path === inc.path);
      if (existing) {
        if (Array.isArray(inc.symbols)) existing.symbols = strArr(inc.symbols);
        if (isStr(inc.hash)) existing.hash = inc.hash; // only verified appends carry a hash
      } else {
        note.anchors.push({
          path: inc.path,
          ...(Array.isArray(inc.symbols) ? { symbols: strArr(inc.symbols) } : {}),
          ...(isStr(inc.hash) ? { hash: inc.hash } : {}),
        });
      }
    }
  }

  if (Array.isArray(rec.behaviors)) {
    for (const raw of rec.behaviors) {
      if (!raw || typeof raw !== 'object') continue;
      const b = raw as Behavior;
      if (!isStr(b.concept_id) || !isStr(b.detail)) continue;
      const inc: Behavior = { concept_id: b.concept_id, detail: b.detail, ...(Array.isArray(b.symbols) ? { symbols: strArr(b.symbols) } : {}) };
      const idx = note.behaviors.findIndex((x) => x.concept_id === inc.concept_id);
      if (idx >= 0) note.behaviors[idx] = inc; // replace the matching entry, keep the others
      else note.behaviors.push(inc);
    }
  }

  if (Array.isArray(rec.features)) {
    for (const raw of rec.features) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Feature;
      if (!isStr(f.concept_id)) continue;
      const existing = note.features.find((x) => x.concept_id === f.concept_id);
      if (existing) { if (isStr(f.role)) existing.role = f.role; } // union; later role wins
      else note.features.push({ concept_id: f.concept_id, role: isStr(f.role) ? f.role : '' });
    }
  }

  if (Array.isArray(rec.steps)) {
    // Whole-array LWW: an ordered story is replaced, not spliced.
    note.steps = rec.steps
      .filter((s): s is FlowStep => !!s && typeof s === 'object' && isStr((s as FlowStep).path) && isStr((s as FlowStep).role))
      .map((s) => ({ path: s.path, role: s.role, ...(Array.isArray(s.symbols) ? { symbols: strArr(s.symbols) } : {}) }));
  }

  for (const inv of strArr(rec.invariants)) if (!note.invariants.includes(inv)) note.invariants.push(inv);

  // Tolerant reader: unknown fields ride along, shallow LWW.
  for (const [k, v] of Object.entries(rec)) {
    if (ENVELOPE_KEYS.has(k) || PUT_KEYS.has(k) || OP_KEYS.has(k)) continue;
    note.extra[k] = v;
  }
}

/** Returns false when the retract was skipped (bad target). */
function applyRetract(note: FoldedNote, rec: Rec, warnings: string[], at: string): boolean {
  const target = rec.target as RetractTarget | undefined;
  if (!target || typeof target !== 'object' || !isStr(target.kind)) {
    warnings.push(`${at}: retract without a valid target — skipped`);
    return false;
  }
  const key = target.key;
  switch (target.kind) {
    case 'behavior': note.behaviors = note.behaviors.filter((b) => b.concept_id !== key); return true;
    case 'feature': note.features = note.features.filter((f) => f.concept_id !== key); return true;
    case 'anchor': note.anchors = note.anchors.filter((a) => a.path !== key); return true;
    case 'invariant': note.invariants = note.invariants.filter((t) => t !== key); return true;
    case 'alias': note.aliases = note.aliases.filter((t) => t !== key); return true;
    case 'note': note.status = 'retracted'; return true;
    default:
      warnings.push(`${at}: unknown retract kind ${JSON.stringify(target.kind)} — skipped`);
      return false;
  }
}
