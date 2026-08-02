/**
 * `kb repair-aliases` — a deliberate, separate reconciliation pass over
 * identityAliases. Distinct from `kb repair`'s `missing-identity-aliases`
 * check, which catches notes with NO identity aliases at all and is fixed the
 * ordinary way, at write time, per the write guide — unchanged by this file.
 * This command is for the different problem: aliases that exist but no longer
 * describe the file/flow accurately (a note rewritten several times can carry
 * identity-shaped words that were really symptom words for an earlier write).
 *
 * Cannot be mechanical: an agent has to re-read the current code to judge
 * whether an alias is still true — see repair.ts's header for why aliases
 * were never auto-fixed. This module's only job is assembling the worklist:
 * each note's CAPPED (rendered) identityAliases alongside the FULL uncapped
 * union, so an agent can see what is hiding past the render cap before it
 * retracts anything. Retracting blind is what causes the cap-resurfacing
 * effect — capAliases operates on the full union minus retractions, not on
 * "the visible 12 minus what was removed," so dropping visible entries can
 * silently pull older ones back into view on the next fold.
 *
 * Paginated (default 10/page): a full-notebook pass over every file/flow note
 * would otherwise dump the whole notebook's alias history in one response.
 *
 * STOPS RESURFACING A NOTE ONCE IT'S BEEN REVIEWED: a note stays eligible
 * until a `kb write` on it carries `aliasesVerified:true` (fold.ts stamps
 * `aliasesVerifiedAtEdit = edits` at that record); it drops out of `eligible`
 * below as soon as nothing has changed since. This is why pagination here is
 * NOT "increment --offset by limit each call" the way a stable list would be:
 * `eligible` shrinks out from under a fixed offset as notes get marked
 * verified, so re-running with the previous `nextOffset` would silently skip
 * whatever just shifted into that position. The sanctioned resume is: mark
 * this batch's notes verified, then re-run with the SAME (default 0) offset —
 * verified notes are simply gone from `eligible`, so a fresh slice from the
 * top is always "whatever's still outstanding," no position-tracking needed.
 * `offset`/`nextOffset` still work exactly as documented for anyone who wants
 * to browse without marking anything (they just won't self-advance safely
 * across a marking pass), so the parameter stays, but `aliasRepairWorklist`'s
 * own prose never recommends incrementing it.
 */
import { relative } from 'node:path';
import type { NoteType } from './types.js';
import { loadAll, notePath } from './store.js';
import { readLog } from './raw-log.js';
import { fold } from './fold.js';

export interface AliasRepairEntry {
  note: string;
  type: NoteType;
  title: string;
  notePath: string;
  paths: string[];
  identityAliases: string[];
  /** identityAliases present in the note's full history but NOT in the
   *  current capped render — what a blind retract-from-the-visible-list
   *  would silently resurface. Empty when the full history already fits
   *  under the cap (the common case). */
  hiddenIdentityAliases: string[];
  incidentAliases: string[];
  summary?: string;
}

export interface AliasRepairPage {
  total: number;
  offset: number;
  entries: AliasRepairEntry[];
  /** Present when notes remain past this page. */
  more?: { remaining: number; nextOffset: number };
}

function subjectPaths(n: { anchors?: { path: string }[]; steps?: { path?: string }[] }): string[] {
  const out = new Set<string>();
  for (const a of n.anchors ?? []) if (a.path) out.add(a.path);
  for (const s of n.steps ?? []) if (s?.path) out.add(s.path);
  return [...out];
}

/**
 * Every active file/flow note's identity-alias state, one page at a time.
 * Pure — no writes; the agent reconciles through the ordinary `kb write` path.
 * Sorted by id for a stable, resumable walk across paginated calls.
 */
export function planAliasRepair(root: string, offset = 0, limit = 10): AliasRepairPage {
  const { notes } = loadAll(root);
  const eligible = notes
    .filter((n) => n.status === 'active' && (n.type === 'file' || n.type === 'flow'))
    // Already reconciled and untouched since: drop it. `aliasesVerifiedAtEdit`
    // is only ever set by an explicit `aliasesVerified:true` write (never
    // implied by an ordinary put), so this can't hide a note whose aliases
    // genuinely changed without anyone confirming them.
    .filter((n) => n.aliasesVerifiedAtEdit === undefined || n.aliasesVerifiedAtEdit < n.edits)
    .sort((a, b) => a.id.localeCompare(b.id));

  const page = eligible.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  const entries: AliasRepairEntry[] = page.map((n) => {
    const { records } = readLog(root, n.id);
    const { note: uncapped } = fold(n.id, records, { capIdentity: false });
    const full = uncapped?.identityAliases ?? n.identityAliases;
    const capped = new Set(n.identityAliases);
    return {
      note: n.id, type: n.type, title: n.title,
      notePath: relative(root, notePath(root, n.id)),
      paths: subjectPaths(n),
      identityAliases: n.identityAliases,
      hiddenIdentityAliases: full.filter((a) => !capped.has(a)),
      incidentAliases: n.incidentAliases,
      ...(n.summary ? { summary: n.summary } : {}),
    };
  });

  const seen = Math.max(0, offset) + page.length;
  const remaining = eligible.length - seen;
  return {
    total: eligible.length, offset: Math.max(0, offset), entries,
    ...(remaining > 0 ? { more: { remaining, nextOffset: seen } } : {}),
  };
}

/** The worklist text an agent acts on — same self-describing-worklist pattern
 *  `kb repair`'s repairWorklist uses, so the instructions live in one place
 *  reachable from the CLI/MCP/slash-command surfaces alike. */
export function aliasRepairWorklist(page: AliasRepairPage): string {
  if (!page.total) return 'No file/flow notes to reconcile.';

  const shown = page.entries.length ? `${page.offset + 1}-${page.offset + page.entries.length}` : '0';
  const parts: string[] = [
    `kb repair-aliases — reconciling identityAliases, notes ${shown} of ${page.total} still outstanding.`,
    '',
    'For each note below: re-read the code at its files, then judge which identityAliases are still '
    + 'true (keep), which are now stale or symptom-shaped for an earlier write (retract), and whether '
    + 'a "hidden past cap" alias should come back into view. Chain the retracts + one re-put in a single '
    + '`kb write` block with `&&` per note — this is a bulk pass, batch it rather than one call per alias. '
    + 'End that same chain with `{"id":"<note id>","aliasesVerified":true}` even when you kept every alias '
    + 'as-is — that is what marks the note reviewed so it stops appearing here; without it, this exact note '
    + 'reappears on your next run even though nothing was wrong with it.',
    '',
    'Never retract an alias without reading the current code first. incidentAliases are shown for '
    + 'context only — this pass does not touch them; they are replaced automatically the next time the '
    + 'summary changes.',
  ];

  for (const e of page.entries) {
    parts.push('', `## ${e.note} [${e.type}] — ${e.title}`);
    parts.push(`    note:  ${e.notePath}`);
    if (e.paths.length) parts.push(`    files: ${e.paths.join(', ')}`);
    parts.push(`    identityAliases:  ${e.identityAliases.join(', ') || '(none)'}`);
    if (e.hiddenIdentityAliases.length) parts.push(`    hidden past cap:  ${e.hiddenIdentityAliases.join(', ')}`);
    if (e.incidentAliases.length) parts.push(`    incidentAliases:  ${e.incidentAliases.join(', ')} (context only)`);
    if (e.summary) parts.push(`    summary: ${e.summary}`);
  }

  if (page.more) {
    parts.push(
      '',
      `${page.more.remaining} more note${page.more.remaining === 1 ? '' : 's'} not shown. Mark this batch's `
      + 'notes aliasesVerified:true first, then just re-run `kb repair-aliases` again with NO --offset — '
      + 'verified notes drop out on their own, so the same command always surfaces whatever is still '
      + 'outstanding next. (Advancing --offset yourself is unsafe once you start marking notes: the list '
      + 'shrinks as you go, so a fixed offset silently skips whatever shifted into that position.)',
    );
  }
  return parts.join('\n');
}
