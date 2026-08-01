/**
 * `kb repair` — find the notes that are written but cannot be found, and hand
 * them to an agent as a worklist. It NEVER writes.
 *
 * WHY IT DOES NOT FIX ANYTHING ITSELF: every gap it detects needs a judgement
 * only a warm agent can make. Aliases are the words a future reader would type —
 * nothing on disk knows them, and deriving them from the title produces the
 * bloat that made recall worse in the first place. Anchor symbols must be the
 * ones the note is ABOUT, not every symbol the file declares. And `verified` is
 * a claim — "I opened this file" — so auto-filing a flow at its step paths would
 * make the note assert freshness against bytes nobody read. A first pass at this
 * command DID fill symbols mechanically; its dry run proposed anchoring notes to
 * `root`, `out` and `opts`. That is the whole argument.
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
import { relative } from 'node:path';
import { NOTE_CHECKS, REPAIR_CONTRACT_VERSION } from '../../hooks/note-shape.mjs';
import { loadAll, notePath } from './store.js';

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
        notePath: relative(root, notePath(root, n.id)),
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
    'These notes are CORRECT but unfindable: they are missing the fields that make a note '
    + 'retrievable. Nothing here is auto-fixable — each gap needs a judgement about the code, '
    + 'which is why it is your work and not the tool\'s.',
    '',
    'For each note: open its file (and the repo files it names) and decide what belongs there, '
    + 'then write it with the SAME `kb write` you use for any note — a repair is an ordinary '
    + 'update spec carrying the note\'s "id", and fields merge, so nothing already in the note '
    + 'is lost. The `fix:` line under each finding is that spec with the id filled in; replace '
    + 'the placeholder values with real ones. Never invent an alias from the title, and never '
    + 'add a path to "verified" unless you actually opened it — a wrong repair is worse than '
    + 'the gap.',
    '',
    'Work through every note below. If a finding is genuinely not worth fixing (a config file '
    + 'that declares no symbols, a flow that only mentions a file in passing), skip it and say '
    + 'so — do not write a note to silence the check.',
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
