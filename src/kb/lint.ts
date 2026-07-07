/**
 * kb lint — mechanical checks ONLY. Flags, never auto-fixes; the output is a
 * worklist for the next warm agent, never an auto-edit. (The staleness half is
 * already the hash tripwire — that's search/status's job, not lint's.)
 *
 * Checks:
 *   dead-anchor        anchor path no longer exists
 *   duplicate-flows    two flow notes share most anchors (set math — catches
 *                      cross-branch duplicate coinage where no agent was present)
 *   orphan             flow/lesson never referenced by any other note
 *   absence-stale      an absence note's stored search now returns hits
 *   malformed          unparseable/invalid raw records (tolerant-reader warnings)
 */
import { stampCoversTerms, type KbNotesIndex } from './notes-index.js';
import { stampAnchors } from './freshness.js';
import { loadAll } from './store.js';

export interface LintFinding {
  check: 'dead-anchor' | 'duplicate-flows' | 'orphan' | 'absence-stale' | 'malformed';
  note: string;
  detail: string;
}

const DUP_JACCARD = 0.6;

export async function kbLint(root: string, notesIndex?: KbNotesIndex | null): Promise<LintFinding[]> {
  const { notes, warnings } = loadAll(root);
  const findings: LintFinding[] = [];

  for (const w of warnings) findings.push({ check: 'malformed', note: w.split(/[ .]/)[0], detail: w });

  const active = notes.filter((n) => n.status === 'active');

  // dead anchors
  for (const n of active) {
    for (const s of stampAnchors(root, n.anchors)) {
      if (s.state === 'missing') findings.push({ check: 'dead-anchor', note: n.id, detail: `anchor gone: ${s.path}` });
    }
  }

  // duplicate flows by anchor-set overlap (pure set math)
  const flows = active.filter((n) => n.type === 'flow' && n.anchors.length >= 2);
  for (let i = 0; i < flows.length; i++) {
    for (let j = i + 1; j < flows.length; j++) {
      const a = new Set(flows[i].anchors.map((x) => x.path));
      const b = new Set(flows[j].anchors.map((x) => x.path));
      let shared = 0;
      for (const p of a) if (b.has(p)) shared++;
      const jaccard = shared / (a.size + b.size - shared);
      if (jaccard >= DUP_JACCARD) {
        findings.push({
          check: 'duplicate-flows', note: flows[i].id,
          detail: `${flows[i].id} and ${flows[j].id} share ${shared} of ${a.size + b.size - shared} anchors — possible duplicate concept; a warm agent should merge (supersede one)`,
        });
      }
    }
  }

  // orphans — flow/lesson nobody references (inbound = [[wikilink]] in prose or a file note's features)
  const referenced = new Set<string>();
  for (const n of notes) {
    for (const f of n.features) referenced.add(f.concept_id);
    for (const f of n.facets) for (const id of f.flows ?? []) referenced.add(id);
    for (const text of [n.summary ?? '', n.body ?? '', ...n.behaviors.map((b) => b.detail), ...n.facets.map((f) => f.detail), ...n.invariants]) {
      for (const m of text.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) referenced.add(m[1]);
    }
  }
  for (const n of active) {
    if (n.type !== 'file' && !referenced.has(n.id)) {
      findings.push({ check: 'orphan', note: n.id, detail: `no other note references ${n.id} — fine if new; a signal if old and unused` });
    }
  }

  // absence stamps (keeper re-runs the stored searches; skipped without a notes index)
  if (notesIndex) {
    for (const n of active) {
      if (n.type !== 'lesson' || n.kind !== 'absence' || !n.scope?.terms.length) continue;
      const stamp = notesIndex.absence[n.id];
      if (!stampCoversTerms(stamp, n.scope.terms)) continue; // keeper hasn't stamped this note yet
      const hits = stamp.matches;
      if (hits.length) {
        findings.push({ check: 'absence-stale', note: n.id, detail: `stored search now matches: ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` +${hits.length - 3}` : ''}` });
      }
    }
  }

  return findings;
}

/** Orphan/duplicate lookups need `notes` too — expose the load for the CLI. */
export function lintSummary(findings: LintFinding[]): string {
  if (!findings.length) return 'kb lint: clean — no flags.';
  const byCheck = new Map<string, LintFinding[]>();
  for (const f of findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }
  const parts: string[] = [`kb lint: ${findings.length} flag${findings.length === 1 ? '' : 's'} (worklist for the next warm agent — nothing is auto-fixed)`];
  for (const [check, list] of byCheck) {
    parts.push(`\n## ${check} (${list.length})`);
    for (const f of list) parts.push(`- ${f.note}: ${f.detail}`);
  }
  return parts.join('\n');
}
