/**
 * Notebook KB — shared types.
 *
 * The `.raw` record (RawRecord) is the FOREVER-FORMAT: every record carries
 * `v: 1`, evolution is additive-only within a major, and readers are tolerant
 * (unknown fields are preserved, unknown ops/types are skipped with a warning,
 * never a hard error). All compat discipline concentrates here — the rendered
 * markdown is derived and can always be re-rendered.
 *
 * See docs/notebook-kb-design.md (contract) + docs/notebook-kb-implementation-plan.md.
 */

export type NoteType = 'file' | 'flow' | 'lesson';
export type LessonKind = 'absence';
export type NoteStatus = 'active' | 'superseded' | 'retracted';
export type RawOp = 'put' | 'retract' | 'supersede';

/** A file note's declared character — the agent that read the file judges it.
 *  hub: no single purpose; knowledge lives as symbol-keyed facets.
 *  single: one purpose; one summary paragraph. */
export type FileCharacter = 'hub' | 'single';

/** An anchor as stored in a `.raw` record / folded note. `hash` and `head` are
 *  present only once some record verified the path (injected by the tool at
 *  append time — the agent never writes either). */
export interface Anchor {
  path: string;
  symbols?: string[];
  hash?: string; // "sha256:<12 hex>" | "missing"
  head?: string; // git HEAD (12 hex) at last verify — provenance, not a verdict
}

/** Hub file-note: one symbol's knowledge, addressed by (file path, symbol).
 *  `flows` are back-refs to flow-note ids that contributed the knowledge.
 *  `head` is tool-stamped from the writing record (never agent-supplied). */
export interface Facet {
  symbol: string;
  detail: string;
  flows?: string[];
  head?: string;
}

/** File-note: a non-obvious behavior, keyed by concept. Symbols are pointers. */
export interface Behavior {
  concept_id: string;
  symbols?: string[];
  detail: string;
}

/** File-note: this file's part in a larger flow (links to the flow note id). */
export interface Feature {
  concept_id: string;
  role: string;
}

/** Flow-note: one ordered handoff in the cross-file story. */
export interface FlowStep {
  path: string;
  symbols?: string[];
  role: string;
}

/** Absence lessons store the search that produced "nothing"; freshness = re-run it. */
export interface AbsenceScope {
  terms: string[];
  globs?: string[];
}

/** Retract tombstone target. `key` is a concept_id (behavior/feature), a
 *  symbol (facet), a path (anchor), exact text (invariant/alias), or omitted
 *  for kind "note". */
export interface RetractTarget {
  kind: 'behavior' | 'feature' | 'facet' | 'anchor' | 'invariant' | 'alias' | 'note';
  key?: string;
}

/** Flat op payload shared by RawRecord and NewRecordInput (all optional —
 *  a put is a partial spec; retract/supersede use target/by). */
export interface RecordPayload {
  // ---- op: "put" payload ----
  title?: string;
  aliases?: string[];
  anchors?: Anchor[];
  /** Paths the agent re-inspected this session; the tool hashes exactly these. */
  verified?: string[];
  summary?: string; // file + flow
  character?: FileCharacter; // file
  facets?: Facet[]; // file (hub)
  behaviors?: Behavior[]; // file
  features?: Feature[]; // file
  steps?: FlowStep[]; // flow
  invariants?: string[]; // flow
  kind?: LessonKind; // lesson
  body?: string; // lesson
  scope?: AbsenceScope; // lesson (absence)

  // ---- op: "retract" ----
  target?: RetractTarget;

  // ---- op: "supersede" ----
  by?: string;
}

/**
 * One line of `.raw/<id>.jsonl`. Envelope + flat op payload.
 * Unknown extra fields are legal and preserved through fold → render.
 */
export interface RawRecord extends RecordPayload {
  v: number;
  ts: string; // ISO, tool-stamped at append — never agent-supplied
  head?: string; // git HEAD (12 hex) at append, tool-stamped; absent outside git
  id: string;
  type: NoteType;
  op: RawOp;

  // Tolerant reader: anything else rides along.
  [key: string]: unknown;
}

/** What the caller hands to appendRecord — the tool stamps `v` and `ts`. */
export interface NewRecordInput extends RecordPayload {
  id: string;
  type: NoteType;
  op: RawOp;
  [key: string]: unknown;
}

/** The deterministic result of folding a note's `.raw` log in ts order. */
export interface FoldedNote {
  id: string;
  type: NoteType;
  title: string;
  aliases: string[];
  anchors: Anchor[];
  status: NoteStatus;
  supersededBy?: string;
  updated: string; // max ts folded
  edits: number; // count of applied records

  summary?: string;
  character?: FileCharacter;
  facets: Facet[];
  behaviors: Behavior[];
  features: Feature[];
  steps: FlowStep[];
  invariants: string[];
  kind?: LessonKind;
  body?: string;
  scope?: AbsenceScope;
  /** git HEAD of the last applied record that carried one. */
  head?: string;

  /** Unknown record fields, shallow-merged last-writer-wins. Preserved into frontmatter. */
  extra: Record<string, unknown>;
}

export type AnchorState = 'fresh' | 'changed' | 'missing' | 'unverified';

export interface StampedAnchor {
  path: string;
  symbols?: string[];
  state: AnchorState;
  /** Stored (last-verified) hash, when one exists. */
  hash?: string;
}
