/**
 * `kb repair` — find the notes that are written but cannot be found, and hand
 * them to an agent as a worklist.
 *
 * WHY MOST OF IT DOES NOT FIX ANYTHING ITSELF: most gaps need a judgement only
 * a warm agent can make. Aliases are the words a future reader would type —
 * nothing on disk knows them, and deriving them from the title produces the
 * bloat that made recall worse in the first place. And `verified` is a claim —
 * "I opened this file" — so auto-filing a flow at its step paths would make the
 * note assert freshness against bytes nobody read.
 *
 * THE ONE MECHANICAL EXCEPTION (`mechanicalSymbolRepair`, 2026-08-02): anchor
 * symbols on a SINGLE-character file note. A first pass at this command DID
 * fill symbols mechanically for every file note; its dry run proposed anchoring
 * notes to `root`, `out` and `opts` — noise, not signal, and the whole reason
 * this file's fixes stopped there. That heuristic is not this one: this reads
 * `index.files.get(path).symbols` via the kb-notes-index sidecar — the SAME
 * curated top-level-declaration list `gs`/`find` already surface successfully
 * everywhere else in the product, not a raw AST/local-variable scan. It is
 * still scoped narrowly on purpose: `character: 'hub'` notes are EXCLUDED
 * (their symbols are curated per-facet by design — a hub is exactly the file
 * shape most likely to have many declared symbols and least likely to want all
 * of them dumped in, which is the shape of file the root/out/opts failure would
 * most plausibly repeat on). An anchor that already has ANY symbols is never
 * touched — this only fills emptiness, never overrides agent curation. A path
 * the sidecar has no data for (unsupported language, or genuinely symbol-less —
 * css/config/markdown) is left as a `file-no-symbols` finding, agent work same
 * as before. Only the note's OWN anchor is fillable at all — see
 * mechanicalSymbolRepair for why a secondary anchor cannot be written.
 *
 * WHY IT EXISTS AT ALL: notes written before the shape was frozen are missing
 * fields their writer was never asked for. The MCP kb_write description never
 * mentioned `aliases`, so notebooks driven by no-shell clients are the worst
 * affected. Those notes are correct — just unreachable — and there are too many
 * to find by hand.
 *
 * The checks live in hooks/note-shape.mjs, next to the write-time warnings that
 * enforce the same fields, so what repair flags and what `kb write` asks for
 * cannot drift. Adding a criterion later means appending one entry there.
 */
import { relative, sep } from 'node:path';
import { NOTE_CHECKS, REPAIR_CONTRACT_VERSION } from '../../hooks/note-shape.mjs';
import { loadAll, notePath } from './store.js';
import { fileNoteId } from './ids.js';
import { loadKbNotesIndex, type KbNotesIndex } from './notes-index.js';
import { kbWrite } from './write.js';

/** Mirrors the alias-surface-area caution (fold.ts's ALIAS_MAX): a file
 *  declaring far more than this is probably hub-shaped even if mislabeled
 *  "single" — dumping all of it would dilute the anchor channel the same way
 *  an uncapped alias union did. Cap, don't refuse; the rest stays reachable via
 *  `gs` even if not anchored on the note. */
export const SYMBOL_BACKFILL_CAP = 15;

export interface MechanicalRepairResult {
  fixed: { note: string; path: string; symbols: string[] }[];
}

/**
 * Backfill anchors[].symbols on single-character file notes from the
 * kb-notes-index sidecar — the one check in this file that WRITES, because
 * unlike aliases/verified this data is already fully derived, not judged. See
 * the file header for why this is safe where the earlier mechanical pass
 * wasn't, and why hub notes stay excluded.
 *
 * Degrades gracefully with no sidecar (keeper never started this repo) —
 * `planRepairs` still works without it, just without this mechanical pass;
 * those notes fall through to the ordinary `file-no-symbols` agent finding.
 *
 * `preloadedSidecar`: the keeper's auto-trigger (index-manager.ts, fired right
 * after it rebuilds+saves this exact sidecar) already has it in memory — this
 * skips the redundant disk read/parse for that caller. CLI/MCP callers omit it
 * and read from disk as before.
 */
export async function mechanicalSymbolRepair(
  root: string, baseCacheDir?: string, preloadedSidecar?: KbNotesIndex,
): Promise<MechanicalRepairResult> {
  const fixed: MechanicalRepairResult['fixed'] = [];
  const sidecar = preloadedSidecar ?? loadKbNotesIndex(root, baseCacheDir);
  if (!sidecar) return { fixed };

  const { notes } = loadAll(root);
  for (const n of notes) {
    if (n.status !== 'active' || n.type !== 'file' || n.character === 'hub') continue;

    // ONLY the note's own anchor — the one whose path derives this note's id.
    // A file note can carry secondary anchors (raw-log.ts stamps one for every
    // `verified` path), but they are unfillable by construction: kbWrite
    // overwrites a file record's anchors with a single entry at `spec.path`
    // (write.ts, "the file IS the anchor"), so re-putting a secondary anchor
    // under ITS own path just sends the record to a different note — the
    // intended anchor stays empty and this pass re-fires forever, eventually
    // tripping the keeper's streak cap and disabling itself.
    const own = n.anchors.find((a) => fileNoteId(a.path) === n.id);
    if (!own) continue;
    if ((own.symbols ?? []).filter(Boolean).length) continue; // never override existing curation
    const declared = (sidecar.anchors[own.path] ?? []).filter(Boolean);
    if (!declared.length) continue; // unsupported language or genuinely symbol-less — agent's call
    const symbols = declared.slice(0, SYMBOL_BACKFILL_CAP);

    const res = await kbWrite(root, {
      type: 'file', path: own.path, anchors: [{ path: own.path, symbols }],
      // This write provably does not touch aliases, so it must not un-review
      // them: without carrying the stamp forward, `edits` advances past
      // `aliasesVerifiedAtEdit` and the note resurfaces in `kb repair-aliases`
      // as if a human judgement had gone stale. Only ever carried when the note
      // was ALREADY verified as of its current edit — never asserted fresh.
      ...(n.aliasesVerifiedAtEdit === n.edits ? { aliasesVerified: true } : {}),
    });
    if (res.status === 'written') fixed.push({ note: n.id, path: own.path, symbols });
  }
  return { fixed };
}

export interface RepairFinding {
  /** Stable id consumers filter on. Never removed once shipped — a retired
   *  check keeps its id and simply stops matching. */
  check: string;
  note: string;
  /** Folded note type: file | flow | lesson. */
  type: string;
  title: string;
  /** The note's markdown file, repo-relative — what the agent opens first. */
  notePath: string;
  /** Repo files the note is about: anchors for a file note, step paths for a
   *  flow. The agent needs these to re-read the code before deciding. */
  paths: string[];
  /** Why this makes the note unfindable. */
  detail: string;
  /** What the agent has to do about it. */
  hint: string;
  /** A spec fragment to merge into the note; carries the id already. */
  fix: string;
}

export interface RepairReport {
  v: number;
  notes: number;
  findings: RepairFinding[];
}

/** Files a finding points the agent at: a file note's anchors, a flow's steps. */
function subjectPaths(n: { anchors?: { path: string }[]; steps?: { path?: string }[] }): string[] {
  const out = new Set<string>();
  for (const a of n.anchors ?? []) if (a.path) out.add(a.path);
  for (const s of n.steps ?? []) if (s?.path) out.add(s.path);
  return [...out];
}

/**
 * Every active note, every check that applies to its type. Pure — no writes, no
 * index load (the notebook is the only input, which is what lets repair run in a
 * repo whose keeper has never started).
 */
export function planRepairs(root: string): RepairReport {
  const { notes } = loadAll(root);
  const active = notes.filter((n) => n.status === 'active');
  const findings: RepairFinding[] = [];

  for (const n of active) {
    for (const c of NOTE_CHECKS) {
      if (!c.noteTypes.includes(n.type)) continue;
      if (!c.missingInNote(n)) continue;
      const ctx = { path: n.anchors[0]?.path, ...(c.context?.(n) ?? {}) };
      findings.push({
        check: c.check,
        note: n.id,
        type: n.type,
        title: n.title,
        // Forward-slash, like every other path coldstart prints. `relative()`
        // is OS-native, so on Windows this rendered
        // `.coldstart\notebook\notes\x.md` — inconsistent with the `→ open:`
        // paths elsewhere, and actively wrong for the agent reading this page,
        // since the very next step is pasting it into a `kb write` JSON spec
        // where a backslash is an escape character.
        notePath: relative(root, notePath(root, n.id)).split(sep).join('/'),
        paths: subjectPaths(n),
        detail: c.why,
        hint: c.repairHint,
        fix: `{"id":"${n.id}","type":"${n.type}",${c.fix(ctx)}}`,
      });
    }
  }
  // Group by check so the agent works one KIND of gap at a time — the fix for
  // twelve alias-less notes is one mental mode, not twelve.
  const order = NOTE_CHECKS.map((c) => c.check);
  findings.sort((a, b) => (order.indexOf(a.check) - order.indexOf(b.check)) || a.note.localeCompare(b.note));

  return { v: REPAIR_CONTRACT_VERSION, notes: active.length, findings };
}

/** The worklist an agent acts on. Deliberately self-describing: the same text
 *  reaches the CLI, the MCP tool, and all three hosts' slash commands, so the
 *  instructions cannot be something only one wrapper happens to say. */
export function repairWorklist(report: RepairReport): string {
  if (!report.findings.length) return 'Nothing to repair here.';

  const byCheck = new Map<string, RepairFinding[]>();
  for (const f of report.findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }
  const noteIds = new Set(report.findings.map((f) => f.note));

  const parts: string[] = [
    `kb repair — ${report.findings.length} gap${report.findings.length === 1 ? '' : 's'} across `
    + `${noteIds.size} of ${report.notes} note${report.notes === 1 ? '' : 's'}.`,
    '',
    'Below is a list of notes that do not match the expected note shape. They are historical '
    + 'notes, written before the shape was frozen — correct, but unfindable.',
    '',
    'Fix them with `kb write`. For each note: open the note file and the codebase files it '
    + 'names, read that code properly, then update the note so a future agent can find it. The '
    + '`fix:` line under each finding is the spec to send — it already carries the note\'s "id", '
    + 'and fields merge, so nothing already in the note is lost; replace the placeholder values '
    + 'with real ones.',
    '',
    'Never invent an alias from the title, and never add a path to "verified" unless you opened '
    + 'it. Skip a finding that genuinely is not worth fixing (a config file that declares no '
    + 'symbols) and say why.',
  ];

  for (const [check, list] of byCheck) {
    parts.push('', `## ${check} (${list.length})`, `${list[0].detail}`, `→ ${list[0].hint}`, '');
    for (const f of list) {
      parts.push(`- ${f.note} [${f.type}] — ${f.title}`);
      parts.push(`    note:  ${f.notePath}`);
      if (f.paths.length) parts.push(`    files: ${f.paths.join(', ')}`);
      parts.push(`    fix:   ${f.fix}`);
    }
  }
  return parts.join('\n');
}
