#!/usr/bin/env node
/**
 * recall-seen.mjs — per-session dedup state for the recall hooks.
 *
 * 61% of notebook injections re-showed a note the SAME session had already
 * been given (worst case 12x). That is pure tax: the title and gist are
 * already in the agent's context, so the repeat buys nothing and pushes the
 * page toward the host's size cap. Each recall hook remembers the ids it has
 * shown and passes them to `kb search --seen`, which drops them from the page
 * it would otherwise have rendered (no backfill; all-seen => inject nothing).
 *
 * Reset on COMPACTION, not on a clock. After a compact the session id is
 * unchanged but the agent's context is gone, so a previously-shown note is
 * genuinely absent again and SHOULD be re-injectable. A shrinking transcript
 * file is the observable signal — the same one kb-elicit uses for its own
 * resume handling. Hosts that expose no transcript path (ephemeral Codex runs)
 * simply never reset: dedup still works, it just holds for the whole session.
 *
 * Shared by kb-recall.mjs (Claude), cursor-kb-recall.mjs and
 * codex-kb-recall.mjs so the three cannot drift. Every function is fail-open:
 * any error leaves dedup OFF rather than blocking recall.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SEEN_TTL_MS = 24 * 60 * 60 * 1000;
/** os.tmpdir(), NOT literal /tmp — that path is reserved for the find_nudge
 *  state file, which the nudge handler reads back by an agreed literal path. */
const seenPath = (sid) => join(tmpdir(), `coldstart-recall-seen-${sid}.json`);

function transcriptSize(p) {
  try { return p ? statSync(p).size : 0; } catch { return 0; }
}

/**
 * Ids already shown this session. `log` is optional (each host has its own).
 * Returns { ids, size } — pass both back to writeSeen.
 */
export function readSeen(sid, transcriptPath, log) {
  if (!sid) return { ids: [], size: 0 };
  try {
    const st = JSON.parse(readFileSync(seenPath(sid), "utf8"));
    if (!st || !Array.isArray(st.ids)) return { ids: [], size: 0 };
    if (Date.now() - (st.ts || 0) > SEEN_TTL_MS) return { ids: [], size: 0 };
    const now = transcriptSize(transcriptPath);
    if (now && st.size && now < st.size) {
      log?.(`compaction detected (${st.size} -> ${now} bytes): clearing ${st.ids.length} seen ids`);
      return { ids: [], size: now };
    }
    return { ids: st.ids, size: st.size || 0 };
  } catch { return { ids: [], size: 0 }; }
}

export function writeSeen(sid, ids, transcriptPath) {
  if (!sid) return;
  try {
    writeFileSync(seenPath(sid), JSON.stringify({
      ids: [...new Set(ids)].slice(-200), // bounded; a session never shows this many
      size: transcriptSize(transcriptPath),
      ts: Date.now(),
    }));
  } catch { /* fail-open: dedup is an optimisation, never a gate */ }
}

/** Note ids on a rendered pointer page — each hit carries `→ open: …/<id>.md`.
 *  Read back off the rendered text so the hooks need no structured output. */
export function idsInPage(page) {
  return [...page.matchAll(/→ open:\s*\S*?notes\/([\w.-]+)\.md/g)].map((m) => m[1]);
}

/** The `--seen a,b,c` argv fragment, or [] when there is nothing to exclude. */
export function seenArgs(ids) {
  return ids.length ? ["--seen", ids.join(",")] : [];
}
