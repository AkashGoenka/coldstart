/**
 * note-shape.mjs — THE single source of truth for what a notebook note must
 * carry to be findable, and the one place the spec shapes are written down.
 *
 * WHY IT EXISTS: this list used to be hand-maintained in three places — the
 * `kb write` guide, the capture prompt's inlined shapes, and the MCP kb_write
 * tool description — and they drifted, silently, for months. The capture
 * prompt's flow shape lost "aliases" and every flow written from it went into
 * the notebook reachable only by its exact title. The MCP description has never
 * mentioned "aliases" at all, which is why notebooks driven by no-shell clients
 * are the worst affected. Nothing ever checked, because there was nothing to
 * check against. Now there is: every surface renders from the tables below, and
 * `tests/kb-shape-parity.test.ts` fails if a consumer stops doing so.
 *
 * WHY IT LIVES IN hooks/ AND NOT src/: the capture hooks are plain .mjs that
 * run straight from the package with no build step and never import from dist/.
 * The TypeScript side already reaches into hooks/ for exactly this reason (see
 * lint.ts and hooks/ignore.mjs), so putting the table here is what lets ONE file
 * serve the hook, the CLI, and the MCP server. Types are in note-shape.d.mts.
 *
 * ADDING A REQUIREMENT LATER (the forward-ready path the design asks for):
 * append to NOTE_CHECKS. Every consumer picks it up — the guide text, the
 * capture prompt, the MCP description, the write-time warning, and `kb repair`'s
 * detection. Never delete a `check` id that has shipped: `kb repair --json`
 * consumers filter by it, so retire one by making its predicate always return
 * false rather than by removing the entry.
 */

/** Bumped when the shape of a `kb repair --json` finding changes, never when a
 *  check is added or retired — consumers filter by `check` and ignore unknowns. */
export const REPAIR_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// The spec shapes — rendered by the write guide, the capture prompt, and the
// MCP tool description. One example string per spec type, used verbatim by all
// three, so the copies cannot disagree about a field.
// ---------------------------------------------------------------------------

export const SPEC_SHAPES = [
  {
    spec: 'file-single',
    noteType: 'file',
    headline: 'file (single purpose — the DEFAULT for file notes):',
    example: `
      {"type":"file-single","path":"src/x.py",
       "summary":"its one purpose + how (1-3 sentences)",
       "aliases":["symptom or search words"],
       "anchors":[{"path":"src/x.py","symbols":["TheFnYouWorkedWith"]}]}`,
    /** Prose the full (guide) rendering adds; the compact rendering drops it. */
    note: `
      "symbols" is how a note answers a search for the NAME of a thing. Agents
      search kb with identifiers far more than with prose, and those land in the
      anchor channel — which holds nothing but the path unless you fill it. Name
      the symbols you actually worked with; omit only for a file that declares
      none (config, css, markdown).`,
  },
  {
    spec: 'file-hub',
    noteType: 'file',
    headline: `
      file (hub — ONLY for grab-bag files with NO single purpose: models.py,
        utils, helpers. One facet PER SYMBOL you worked with. Touching many
        symbols does not make a file a hub; a single-purpose file stays
        file-single):`,
    example: `
      {"type":"file-hub","path":"src/y.py","aliases":["search words"],
       "facets":[{"symbol":"ClassOrFn","detail":"the non-obvious thing about THIS symbol",
                  "flows":["<flow id or the flow's exact title>"]}]}`,
    note: '',
  },
  {
    spec: 'flow',
    noteType: 'flow',
    headline: 'flow (product-level mechanism — see the capture checklist\'s gate):',
    example: `
      {"type":"flow","title":"how X happens","aliases":["other words for X"],
       "summary":"first sentence = the product-level fact the file notes miss",
       "steps":[{"path":"src/a.py","symbols":["entry"],"role":"receives the request"}],
       "invariants":["what must hold"],"verified":["src/a.py"]}`,
    note: `
      "steps" is the chain. "verified" is what FILES the note — anchors come from
      "verified" (plus any explicit "anchors"), NOT from the steps. List in
      "verified" every step file you actually opened this session, or the note is
      not filed at those addresses: kb lookup on them returns nothing and they are
      never freshness-stamped. Do not reuse the file-note shape (title + summary)
      from memory for a flow.`,
  },
  {
    spec: 'lesson',
    noteType: 'lesson',
    headline: 'lesson (confirmed ABSENCE only — one file/symbol facts are facets, not lessons):',
    example: `
      {"type":"lesson","kind":"absence","title":"no retry logic in this repo",
       "body":"what you looked for + that it is not there",
       "scope":{"terms":["search","terms"]}}`,
    note: '',
  },
];

// ---------------------------------------------------------------------------
// The requirements — one entry per way a note can end up unfindable.
//
// Each carries TWO predicates on purpose. `missingInSpec` runs at write time on
// the JSON the agent just sent; `missingInNote` runs in `kb repair` on the
// folded note as it exists on disk. They read different shapes and cannot be
// collapsed into one, so they sit adjacent — a change to what "missing" means
// has to be made in both, in the same edit, in view of each other.
// ---------------------------------------------------------------------------

/** A folded note as `kb repair` sees it (subset of KbNote used by the checks). */
const noteAliases = (n) => (n.aliases ?? []).filter(Boolean);

export const NOTE_CHECKS = [
  {
    check: 'missing-aliases',
    field: 'aliases',
    /** Folded note types this applies to. */
    noteTypes: ['file', 'flow'],
    /** Spec types this applies to at write time. */
    specTypes: ['file', 'file-single', 'file-hub', 'flow'],
    why: '"aliases" — the words someone would SEARCH for this; without them the note is reachable only by its exact title',
    /** What the agent has to do about it, in `kb repair`'s worklist. */
    repairHint:
      'Open the note and name 2-6 phrases someone would type when they hit this — SYMPTOMS and '
      + 'the words in the code (identifiers, error strings), not restatements of the title.',
    fix: () => '"aliases":["2-5 word search keys"]',
    missingInSpec: (s) => !(Array.isArray(s.aliases) && s.aliases.filter(Boolean).length),
    missingInNote: (n) => !noteAliases(n).length,
  },
  {
    // `kb write` REJECTS an absence lesson with no scope.terms, so this can only
    // fire on notes already on disk from before that validation. Kept for them.
    check: 'missing-scope-terms',
    field: 'scope.terms',
    noteTypes: ['lesson'],
    specTypes: ['lesson'],
    why: '"scope.terms" — a lesson has no anchors, so these terms are its only retrieval surface',
    repairHint:
      'Add the terms you would search for to conclude the thing is absent. The keeper re-runs '
      + 'them, so they double as the tripwire that flags the lesson when the absence ends.',
    fix: () => '"scope":{"terms":["what you searched for"]}',
    missingInSpec: (s) => !(Array.isArray(s.scope?.terms) && s.scope.terms.filter(Boolean).length),
    missingInNote: (n) => !(n.scope?.terms ?? []).filter(Boolean).length,
  },
  {
    check: 'file-no-symbols',
    field: 'anchors[].symbols',
    /** A hub reaches the same channel through its facets — write.ts unions every
     *  facet symbol into the anchor — so name the field it actually writes. */
    fieldBySpec: { 'file-hub': 'facets[].symbol' },
    noteTypes: ['file'],
    specTypes: ['file', 'file-single', 'file-hub'],
    why:
      '"anchors[].symbols" (or "facets[].symbol" on a hub) — the identifiers you worked with, if '
      + 'this file declares any; agents search kb by NAME far more than by prose, and those '
      + 'queries only match this channel',
    repairHint:
      'Run `coldstart gs <path>` and anchor the symbols the note is actually ABOUT — not every '
      + 'symbol the file declares. A file that declares none (css, markdown, config) is fine as is.',
    fix: (ctx) => `"anchors":[{"path":"${ctx.path ?? '<path>'}","symbols":["TheFnYouWorkedWith"]}]`,
    missingInSpec: (s) => !(
      (Array.isArray(s.anchors)
        && s.anchors.some((a) => Array.isArray(a?.symbols) && a.symbols.filter(Boolean).length))
      || (Array.isArray(s.facets) && s.facets.some((f) => f?.symbol))),
    missingInNote: (n) => !(n.anchors ?? []).some((a) => (a.symbols ?? []).filter(Boolean).length),
  },
  {
    check: 'flow-no-steps',
    field: 'steps',
    noteTypes: ['flow'],
    specTypes: ['flow'],
    why:
      '"steps" — the chain that makes a flow a flow; without it the note is a title and a '
      + 'paragraph, and there is nothing for a reader to follow into the code',
    repairHint:
      'Re-read the chain and record each hop as {path, symbols, role}. Then list in "verified" '
      + 'the files you opened doing it — that is what files the note.',
    fix: () => '"steps":[{"path":"src/a.py","symbols":["entry"],"role":"receives the request"}]',
    /** Spec-side this is judged against the FOLDED result, not the spec: an
     *  update that touches only aliases legitimately omits steps and the fold
     *  keeps the ones already there. See stepsMissingAfterWrite below. */
    missingInSpec: () => false,
    missingInNote: (n) => !(n.steps ?? []).length,
  },
  {
    check: 'flow-steps-unanchored',
    field: 'verified',
    noteTypes: ['flow'],
    /** Named in the shapes and the tool description so writers list it up front,
     *  but never warned about at write time — a spec's `verified` is a claim
     *  about what the agent read, and the write path has no way to falsify it.
     *  It is caught later, on the folded note, by `kb repair`. */
    specTypes: ['flow'],
    why:
      '"verified" does not cover every step file — a flow is FILED at its verified paths, so a '
      + 'step file missing from them is invisible to `kb lookup` on that file and is never '
      + 'freshness-stamped, even though the note describes what it does',
    repairHint:
      'Open each unfiled step file and confirm the step is real. Re-put the note with those '
      + 'paths in "verified" — only the ones you actually read. Leaving a step unfiled is a fine '
      + 'answer for a file the flow only mentions in passing; say so and move on.',
    fix: (ctx) => `"verified":[${(ctx.unanchored ?? []).map((p) => `"${p}"`).join(',')}]`,
    missingInSpec: () => false,
    missingInNote: (n) => unanchoredSteps(n).length > 0,
    /** Extra context this check contributes to its finding. */
    context: (n) => ({ unanchored: unanchoredSteps(n) }),
  },
];

/** Step paths the note is not filed at. Anchors come from `verified` + explicit
 *  `anchors`; steps are only the story. */
export function unanchoredSteps(n) {
  const anchored = new Set((n.anchors ?? []).map((a) => a.path));
  const seen = new Set();
  const out = [];
  for (const s of n.steps ?? []) {
    if (!s?.path || anchored.has(s.path) || seen.has(s.path)) continue;
    seen.add(s.path);
    out.push(s.path);
  }
  return out;
}

/** A flow write leaves the note stepless. Judged on the FOLDED note (passed in
 *  as `after`) because the spec alone cannot tell an alias-only update from a
 *  flow written without a chain. */
export function stepsMissingAfterWrite(spec, after) {
  if (!spec || spec.type !== 'flow' || spec.op === 'retract') return false;
  if (after) return !(after.steps ?? []).length;
  return !(Array.isArray(spec.steps) && spec.steps.length);
}

// ---------------------------------------------------------------------------
// Renderers — every surface goes through one of these.
// ---------------------------------------------------------------------------

/** Checks that apply to a given SPEC type (what the writer just sent). */
export function checksForSpec(specType) {
  return NOTE_CHECKS.filter((c) => c.specTypes.includes(specType));
}

/** Checks that apply to a given folded NOTE type. */
export function checksForNote(noteType) {
  return NOTE_CHECKS.filter((c) => c.noteTypes.includes(noteType));
}

/**
 * The spec shapes as a block of text.
 * `compact` drops the explanatory prose (the capture prompt pays per token and
 * carries its own rules section); both renderings emit the SAME examples.
 */
export function shapesBlock({ compact = false } = {}) {
  return SPEC_SHAPES.map((s) => {
    const example = indent(dedent(s.example), compact ? '  ' : '    ');
    if (compact) return example;
    return `${indent(dedent(s.headline), '  ')}\n${example}`
      + (s.note ? `\n${indent(dedent(s.note), '      ')}` : '');
  }).join('\n\n');
}

/** Template literals in this file are written at their source indentation and
 *  open with a newline, so every line — including the first — carries the same
 *  prefix. Strip the common prefix and RELATIVE indentation survives, which is
 *  what makes the continuation lines of a JSON example line up under it. */
function dedent(text) {
  const lines = text.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), Infinity);
  return Number.isFinite(pad) ? lines.map((l) => l.slice(pad)).join('\n') : lines.join('\n');
}

function indent(text, prefix) {
  return text.split('\n').map((l) => (l.trim() ? prefix + l : l)).join('\n');
}

/** One line naming the fields a note cannot be retrieved without — for the MCP
 *  tool description and anywhere else that needs the rule without the shapes. */
export function requiredFieldsLine() {
  const byType = SPEC_SHAPES.map((s) => {
    const fields = checksForSpec(s.spec).map((c) => c.fieldBySpec?.[s.spec] ?? c.field);
    return `${s.spec}: ${fields.join(' + ')}`;
  });
  return `REQUIRED for the note to be findable at all — ${byType.join('; ')}. `
    + `A note missing these is written but unreachable: aliases are the only search surface besides `
    + `the exact title, and anchor symbols are the only channel that answers a query typed as an identifier.`;
}
