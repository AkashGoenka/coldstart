/**
 * Types for note-shape.mjs — the table itself is plain ESM so the capture hooks
 * can import it without a build step (see the header there). This declaration is
 * what lets the TypeScript side import the same file instead of copying it.
 */

/** A folded note, as `kb repair` reads it off disk. Structurally a subset of
 *  KbNote in src/kb/types.ts — kept minimal so the checks stay portable. */
export interface ShapeNote {
  id: string;
  type?: string;
  title?: string;
  identityAliases?: string[];
  incidentAliases?: string[];
  anchors?: { path: string; symbols?: string[] }[];
  steps?: { path?: string; symbols?: string[]; role?: string }[];
  scope?: { terms?: string[] };
}

/** The JSON an agent sends to kb write / kb_write. */
export interface ShapeSpec {
  op?: string;
  type?: string;
  path?: string;
  identityAliases?: unknown;
  incidentAliases?: unknown;
  anchors?: { path?: string; symbols?: unknown }[];
  steps?: unknown[];
  scope?: { terms?: unknown };
  [k: string]: unknown;
}

export interface SpecShape {
  spec: string;
  noteType: string;
  headline: string;
  example: string;
  note: string;
}

export interface NoteCheck {
  check: string;
  field: string;
  noteTypes: string[];
  specTypes: string[];
  why: string;
  repairHint: string;
  fix: (ctx: { path?: string; unanchored?: string[] }) => string;
  missingInSpec: (spec: ShapeSpec) => boolean;
  missingInNote: (note: ShapeNote) => boolean;
  context?: (note: ShapeNote) => Record<string, unknown>;
}

export const REPAIR_CONTRACT_VERSION: number;
export const SPEC_SHAPES: SpecShape[];
export const NOTE_CHECKS: NoteCheck[];

export function unanchoredSteps(note: ShapeNote): string[];
export function stepsMissingAfterWrite(spec: ShapeSpec, after?: ShapeNote | null): boolean;
export function checksForSpec(specType: string): NoteCheck[];
export function checksForNote(noteType: string): NoteCheck[];
export function shapesBlock(opts?: { compact?: boolean }): string;
export function requiredFieldsLine(): string;
