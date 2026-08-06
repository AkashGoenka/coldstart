/**
 * write-guide.ts — the `kb write` spec guide + flow-evidence check, shared by
 * the CLI (`kb write` with no spec / --session) and the MCP kb_write tool so
 * both surfaces behave identically (parity rule: every kb surface exists on
 * CLI and MCP with the same semantics; only the invocation howto differs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  shapesBlock, requiredFieldsLine, checksForSpec, stepsMissingAfterWrite,
} from '../../hooks/note-shape.mjs';
import type { WriteSpec } from './write.js';

// The shapes are NOT written here. They come from hooks/note-shape.mjs, which
// the capture prompt and the MCP tool description render from too — three
// hand-kept copies is exactly how "aliases" fell out of the flow shape and how
// the MCP description went years without ever mentioning it.
export const WRITE_GUIDE_SHAPES = `kb write — spec shapes (JSON, one note per spec; include only fields you have):

${shapesBlock()}

  update an existing note: same spec + its "id" (fields merge; yours win).
  retract a wrong claim:   {"op":"retract","id":"<id>","target":{"kind":"note"}}
                           (retract a PART of a note, not the whole thing:
                            {"op":"retract","id":"<id>","target":{"kind":"anchor|alias|facet|invariant|behavior|feature","key":"<the exact value>"}})

${requiredFieldsLine()}

Rules the writer enforces (fix any WARNING it prints, in this session):
  - paths are join keys: repo-relative, exactly as in the repo
  - "verified" re-stamps freshness: list ONLY files you opened this session
  - never compose ids yourself — reference flows by exact title or an id
    copied from kb search output`;

export function writeGuideCli(): string {
  return `${WRITE_GUIDE_SHAPES}

How to run (ONE Bash block, ONE call — author every note as a JSON array):
  cat > /tmp/notes.json <<'SPEC'
  [ { ...note 1... }, { ...note 2... } ]
SPEC
  node <cli> kb write /tmp/notes.json --root <root> --session <sid> --force
A single object still works for a one-off. Order the array flows-first so the
file notes that reference them can resolve. The whole array is written in one
pass: well-formed notes land, malformed ones are reported together, and the
final coverage line lists any worked files still without a note.`;
}

export function writeGuideMcp(): string {
  return `${WRITE_GUIDE_SHAPES}

How to run: call kb_write once with \`specs\` set to an ARRAY of these shapes
(or \`spec\` for a single one). Order flows before the file notes that reference
them. The whole array is written in one call — well-formed notes land, malformed
ones come back reported together, and the result lists any worked files still
without a note.`;
}

// All three hosts' elicit hooks (Claude / Cursor / Codex) share one marker
// namespace as of 2026-08-06 (previously per-host prefixes, which meant manual
// /capture-notes — always the shared kb-elicit.mjs --manual — could never see
// Cursor's or Codex's own automatic evidence). Kept as an array since callers
// below treat it as a set of prefixes to scan.
const MARKER_PREFIXES = ['coldstart-kb-'];

/** Flow-evidence check: how many of the spec's step files did THIS session
 *  actually content-read? Reads the capture markers (v2 evidence records)
 *  the elicit hooks maintain. No marker → no opinion (returns null). */
export function flowEvidenceCount(spec: WriteSpec, session: string): { read: number; steps: number } | null {
  const steps = (spec as { steps?: { path?: string }[] }).steps ?? [];
  const paths = steps.map((s) => s?.path).filter(Boolean) as string[];
  if (!paths.length) return null;
  try {
    const safe = session.replace(/[^A-Za-z0-9_-]/g, '');
    const markers = readdirSync(tmpdir()).filter(
      (f) => MARKER_PREFIXES.some((p) => f.startsWith(`${p}${safe}-`)) && f.endsWith('.json'));
    if (!markers.length) return null;
    const read = new Set<string>();
    for (const m of markers) {
      try {
        const state = JSON.parse(readFileSync(join(tmpdir(), m), 'utf8'));
        if (state?.v !== 2 || !state.files) continue;
        for (const [rel, f] of Object.entries(state.files as Record<string, { reads?: number; edits?: number; gs?: number }>)) {
          if ((f.reads ?? 0) + (f.edits ?? 0) + (f.gs ?? 0) > 0) read.add(rel);
        }
      } catch { /* one bad marker never blocks a write */ }
    }
    if (!read.size) return null;
    return { read: paths.filter((p) => read.has(p)).length, steps: paths.length };
  } catch { return null; }
}

/** The WARN text (never a rejection) when a flow ends up with no `steps` at all.
 *
 *  A stepless flow folds to a note that is a title and a paragraph — no chain to
 *  follow into the code — and still reports `put → <id>` like any success. The
 *  shape is easy to reach by reusing the file-note spec from memory (title +
 *  summary), which is why it needs to be loud rather than silent.
 *
 *  `after` is the note as it stands AFTER the write, and it is what makes this
 *  accurate rather than merely suspicious. The spec alone cannot tell the two
 *  cases apart: an UPDATE that touches only aliases legitimately omits `steps`
 *  and the fold keeps the ones already there — judging by the spec fired at
 *  notes that were perfectly fine. Pass the folded result and the claim is
 *  checked instead of guessed.
 *
 *  Separate from flowEvidenceWarning below: this one needs no session, because
 *  a missing chain is a defect in the note itself, not in its evidence. */
export function flowStepsWarning(spec: WriteSpec, after?: { steps?: unknown[] } | null): string | null {
  if (!stepsMissingAfterWrite(spec as never, after as never)) return null;
  return (
    'flow has no "steps": there is no chain to follow, so the note is a title and a paragraph. ' +
    'Re-put it with steps [{path, symbols, role}], and list in "verified" the step files you ' +
    'actually opened — "verified" is what FILES the note at those paths (anchors come from it, ' +
    'NOT from the steps), and unfiled paths are invisible to `kb lookup`. Run `kb write` with ' +
    'no spec to print the full flow shape.'
  );
}

/**
 * Fields a note needs to be FINDABLE, checked after the write rather than before it.
 *
 * The rules are not written here — they are the same NOTE_CHECKS entries that
 * `kb repair` runs over the notebook, so the thing an agent is told at write
 * time and the thing repair later flags it for cannot disagree.
 *
 * Deliberately not a rejection. The capture prompt tells the agent to chain its
 * writes with `&&`, so a non-zero exit silences every note after the offending
 * one — a strict validator would destroy more knowledge than it saves, and the
 * note is already correct, just under-indexed. The write lands, and the agent is
 * handed the exact one-line re-put that completes it.
 *
 * `after` is the note AS FOLDED, and passing it is what makes this correct on an
 * UPDATE. `op: 'put'` is not a document overwrite — it appends one record and
 * the note is the fold of the whole log, where identityAliases and anchors
 * UNION (incidentAliases don't — see fold.ts). So a spec that touches only
 * `verified` legitimately omits `identityAliases`, and judging
 * the record alone reported every such note as missing fields it already had.
 * A field is missing only when the agent did not send it AND the folded note
 * does not have it. Omit `after` (no folded note to hand) and this falls back to
 * judging the spec, which is exact for a create — there, the two are the same.
 */
export function missingFieldsWarning(
  spec: WriteSpec, id: string, after?: unknown,
): string | null {
  const s = spec as { op?: string; type?: string; path?: string };
  if (!s || s.op === 'retract') return null;
  const type = s.type ?? '';
  const gaps = checksForSpec(type).filter(
    (c) => c.missingInSpec(spec as never) && (!after || c.missingInNote(after as never)),
  );
  if (!gaps.length) return null;
  return (
    `note ${id} is written but under-indexed — missing:\n` +
    gaps.map((c) => `    - ${c.why}`).join('\n') +
    `\n  Complete it now with one more write (fields merge, nothing is lost):\n` +
    `    {"id":"${id}","type":"${type}"${s.path ? `,"path":"${s.path}"` : ''},` +
    `${gaps.map((c) => c.fix({ path: s.path })).join(',')}}`
  );
}

/** The WARN text (never a rejection) when a flow's steps lack read evidence.
 *  null when the spec is not a flow, no session is known, or evidence is fine. */
export function flowEvidenceWarning(spec: WriteSpec, session: string | undefined): string | null {
  if (!spec || (spec as { type?: string }).type !== 'flow' || !session) return null;
  const ev = flowEvidenceCount(spec, session);
  if (!ev || ev.read >= 2) return null;
  return (
    `flow evidence: only ${ev.read} of ${ev.steps} step files were actually read this session — ` +
    `a flow assembled from search hits is the classic bad flow. Keep it only if you truly ` +
    `verified the chain; otherwise retract it now ({"op":"retract","id":"<id>","target":{"kind":"note"}}).`
  );
}
