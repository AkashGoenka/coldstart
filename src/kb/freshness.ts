/**
 * Freshness — the hash tripwire. One hash implementation, two call sites:
 * write-time stamping of verified anchors (raw-log.ts) and read-time
 * verification (search/status output).
 *
 * Whole-file raw-byte SHA-256, first 12 hex — never per-symbol. Freshness is
 * computed at read/search time and NEVER rendered into md (it would be
 * stale-at-write). Bias to false-positive staleness: a false alarm is cheap,
 * silent rot is expensive.
 *
 * Absence-note re-runs need the code index and live in search.ts — this module
 * stays index-free.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type { Anchor, StampedAnchor } from './types.js';

/** Hash a repo-relative file's current bytes. Missing/unreadable → "missing"
 *  (a note outliving its file is itself a signal). */
export function hashFile(root: string, relPath: string): string {
  try {
    const abs = isAbsolute(relPath) ? relPath : join(root, relPath);
    const buf = readFileSync(abs);
    return 'sha256:' + createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch {
    return 'missing';
  }
}

/** Compare each anchor's stored (last-verified) hash against the live file, NOW. */
export function stampAnchors(root: string, anchors: Anchor[]): StampedAnchor[] {
  return anchors.map((a) => {
    const live = hashFile(root, a.path);
    let state: StampedAnchor['state'];
    if (live === 'missing') state = 'missing';
    else if (!a.hash || a.hash === 'missing') state = a.hash === 'missing' ? 'changed' : 'unverified';
    else state = live === a.hash ? 'fresh' : 'changed';
    return { path: a.path, symbols: a.symbols, state, hash: a.hash };
  });
}

/**
 * "Inactive" — a read-time, branch-reactive projection (never stored): true
 * when a note anchors at least one file and EVERY anchored file is absent right
 * now. That is a note whose subject doesn't exist on the current branch — a
 * feature/review-branch note seen from a branch without those files, or a note
 * left behind by a deletion/rename. Computed from live existence on each read,
 * so it flips automatically across a branch switch with no write.
 *
 * A note with no anchors can't be judged this way (never inactive). Lessons are
 * exempt by the caller: an absence lesson is ABOUT non-existence, and its
 * freshness is the keeper's re-run stamp, not anchor presence.
 */
export function anchorsAllMissing(stamped: StampedAnchor[]): boolean {
  return stamped.length > 0 && stamped.every((s) => s.state === 'missing');
}

/** One human line per anchor, used verbatim by search/status output. */
export function freshnessLine(s: StampedAnchor): string {
  switch (s.state) {
    case 'fresh': return `[fresh] ${s.path}`;
    case 'changed': return `[evidence changed: ${s.path}]`;
    case 'missing': return `[anchor missing: ${s.path}]`;
    case 'unverified': return `[never verified: ${s.path}]`;
  }
}
