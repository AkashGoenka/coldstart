/**
 * write-guide.ts — the `kb write` spec guide + flow-evidence check, shared by
 * the CLI (`kb write` with no spec / --session) and the MCP kb_write tool so
 * both surfaces behave identically (parity rule: every kb surface exists on
 * CLI and MCP with the same semantics; only the invocation howto differs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WriteSpec } from './write.js';

// The capture checklist inlines only the two common file-note shapes
// (zero-bounce path); everything else lives here so the prompt stays small
// and this stays current.
export const WRITE_GUIDE_SHAPES = `kb write — spec shapes (JSON, one note per spec; include only fields you have):

  file (single purpose — the DEFAULT for file notes):
    {"type":"file-single","path":"src/x.py",
     "summary":"its one purpose + how (1-3 sentences)",
     "aliases":["symptom or search words"],
     "anchors":[{"path":"src/x.py","symbols":["TheFnYouWorkedWith"]}]}
       "symbols" is how a note answers a search for the NAME of a thing. Agents
       search kb with identifiers far more than with prose, and those land in
       the anchor channel — which holds nothing but the path unless you fill it.
       Name the symbols you actually worked with; omit it only for a file that
       declares none (config, css, markdown).

  file (hub — ONLY for grab-bag files with NO single purpose: models.py, utils,
        helpers. One facet PER SYMBOL you worked with. Touching many symbols
        does not make a file a hub; a single-purpose file stays file-single):
    {"type":"file-hub","path":"src/y.py","aliases":["search words"],
     "facets":[{"symbol":"ClassOrFn","detail":"the non-obvious thing about THIS symbol",
                "flows":["<flow id or the flow's exact title>"]}]}

  flow (product-level mechanism — see the capture checklist's gate).
       "steps" is REQUIRED: a flow's anchors are DERIVED from it, so a flow
       without steps writes a note with NO anchors — unreachable by kb lookup,
       invisible to the anchor channel, never freshness-stamped. Do not reuse
       the file-note shape (title + summary) from memory for a flow:
    {"type":"flow","title":"how X happens","aliases":["other words for X"],
     "summary":"first sentence = the product-level fact the file notes miss",
     "steps":[{"path":"src/a.py","symbols":["entry"],"role":"receives the request"}],
     "invariants":["what must hold"],"verified":["src/a.py"]}

  lesson (confirmed ABSENCE only — one file/symbol facts are facets, not lessons):
    {"type":"lesson","kind":"absence","title":"no retry logic in this repo",
     "body":"what you looked for + that it is not there",
     "scope":{"terms":["search","terms"]}}

  update an existing note: same spec + its "id" (fields merge; yours win).
  retract a wrong claim:   {"op":"retract","id":"<id>","reason":"..."}

Rules the writer enforces (fix any WARNING it prints, in this session):
  - paths are join keys: repo-relative, exactly as in the repo
  - "verified" re-stamps freshness: list ONLY files you opened this session
  - never compose ids yourself — reference flows by exact title or an id
    copied from kb search output`;

export function writeGuideCli(): string {
  return `${WRITE_GUIDE_SHAPES}

How to run (one Bash block total — author specs as heredocs, chain with &&):
  cat > /tmp/spec1.json <<'SPEC'
  { ... }
SPEC
  node <cli> kb write /tmp/spec1.json --root <root> --session <sid> --force
Flows before the file notes that reference them.`;
}

export function writeGuideMcp(): string {
  return `${WRITE_GUIDE_SHAPES}

How to run: call kb_write again with \`spec\` set to one of these shapes.
Flows before the file notes that reference them.`;
}

// Capture markers are per-host (Claude / Cursor / Codex elicit hooks) but all
// share the v2 evidence-record state shape; the flow-evidence check reads
// whichever host produced this session's marker.
const MARKER_PREFIXES = ['coldstart-kb-', 'coldstart-cursor-kb-', 'coldstart-codex-kb-'];

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

/** The WARN text (never a rejection) when a flow carries no `steps` at all.
 *
 *  A flow's anchors are DERIVED from its steps, so a stepless flow folds to a
 *  note with zero anchors and no Steps/Invariants section — and still reports
 *  `put → <id>` like any success. It is then unreachable by `kb lookup <path>`,
 *  invisible to the anchor channel, and never freshness-stamped. The shape is
 *  easy to reach by reusing the file-note spec from memory (title + summary),
 *  which is exactly why it needs to be loud rather than silent.
 *
 *  Separate from flowEvidenceWarning below: this one needs no session, because
 *  a missing `steps` array is a defect in the spec itself, not in its evidence.
 *
 *  `anchorsAfter` is the anchor count of the note as it stands AFTER the write,
 *  and it is what makes this accurate rather than merely suspicious. The spec
 *  alone cannot tell the two cases apart: an UPDATE that touches only aliases
 *  legitimately omits `steps`, and the fold keeps the ones already there — so
 *  judging by the spec fired "this note has NO anchors" at notes holding three
 *  of them. Pass the folded result and the claim is checked instead of guessed. */
export function flowStepsWarning(spec: WriteSpec, anchorsAfter?: number): string | null {
  if (!spec || (spec as { type?: string }).type !== 'flow') return null;
  if ((spec as { op?: string }).op === 'retract') return null;
  if (typeof anchorsAfter === 'number' && anchorsAfter > 0) return null;
  const steps = (spec as { steps?: unknown[] }).steps;
  if (Array.isArray(steps) && steps.length) return null;
  return (
    'flow has no "steps": a flow\'s anchors come from its steps, so this note has NO anchors — ' +
    'kb lookup cannot reach it, the anchor channel cannot match it, and it can never be ' +
    'freshness-stamped. Re-put it with steps [{path, symbols, role}] (and "verified" for the ' +
    'files you actually read). Run `kb write` with no spec to print the full flow shape.'
  );
}

/**
 * Fields a note needs to be FINDABLE, checked after the write rather than before it.
 *
 * Deliberately not a rejection. The capture prompt tells the agent to chain its
 * writes with `&&`, so a non-zero exit silences every note after the offending
 * one — a strict validator would destroy more knowledge than it saves, and the
 * note is already correct, just under-indexed. The write lands, and the agent is
 * handed the exact one-line re-put that completes it.
 *
 * Each rule exists because the corpus proved the field goes missing:
 *  - aliases  — 2 flows in this repo's notebook had none, both written from a
 *               capture-prompt shape that had dropped the field. A flow with no
 *               aliases is reachable only by its exact title.
 *  - symbols  — 2 of 44 notes declared any, because the file-single shape never
 *               asked. The anchor channel is weighted x2 for exactly the
 *               identifier queries agents type, and it was empty corpus-wide.
 *  - scope.terms — a lesson has no anchors by construction; its scope terms are
 *               its ONLY retrieval surface besides the title.
 */
export function missingFieldsWarning(spec: WriteSpec, id: string): string | null {
  const s = spec as {
    op?: string; type?: string; path?: string; aliases?: unknown;
    anchors?: { path?: string; symbols?: unknown }[]; scope?: { terms?: unknown };
  };
  if (!s || s.op === 'retract') return null;
  const type = s.type ?? '';
  const missing: string[] = [];
  const fix: string[] = [];

  const aliases = Array.isArray(s.aliases) ? s.aliases.filter(Boolean) : [];
  if (type !== 'lesson' && !aliases.length) {
    missing.push('"aliases" — the words someone would SEARCH for this; without them the note is reachable only by its exact title');
    fix.push('"aliases":["2-5 word search keys"]');
  }
  if (type === 'lesson') {
    const terms = Array.isArray(s.scope?.terms) ? s.scope!.terms!.filter(Boolean) : [];
    if (!terms.length) {
      missing.push('"scope.terms" — a lesson has no anchors, so these terms are its only retrieval surface');
      fix.push('"scope":{"terms":["what you searched for"]}');
    }
  }
  // Symbol advice is scoped to file notes: a flow carries symbols per step, and
  // a lesson has no anchors at all. Never phrased as an error — plenty of real
  // files (css, markdown, config) declare nothing worth naming.
  if (type === 'file-single' || type === 'file-hub') {
    const hasSymbols = Array.isArray(s.anchors)
      && s.anchors.some((a) => Array.isArray(a?.symbols) && a.symbols.length);
    if (!hasSymbols) {
      missing.push('"anchors[].symbols" — the identifiers you worked with, if this file declares any; agents search kb by NAME far more than by prose, and those queries only match this channel');
      fix.push(`"anchors":[{"path":"${s.path ?? '<path>'}","symbols":["TheFnYouWorkedWith"]}]`);
    }
  }
  if (!missing.length) return null;
  return (
    `note ${id} is written but under-indexed — missing:\n` +
    missing.map((m) => `    - ${m}`).join('\n') +
    `\n  Complete it now with one more write (fields merge, nothing is lost):\n` +
    `    {"id":"${id}","type":"${type}"${s.path ? `,"path":"${s.path}"` : ''},${fix.join(',')}}`
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
    `verified the chain; otherwise retract it now (op "retract").`
  );
}
