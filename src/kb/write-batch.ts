/**
 * Batch write — the capture write path, shared by the CLI (`kb write`) and the
 * MCP `kb_write` tool so both surfaces behave identically.
 *
 * The agent authors ALL its notes as one JSON array and writes them in a single
 * call. That single call boundary is what the old chained-`&&` convention never
 * had, and it buys three things:
 *   1. shape errors across notes are collected and reported TOGETHER, instead of
 *      the first bad note's non-zero exit silencing every note behind it;
 *   2. the end of the array is the one place coverage can be finalized against
 *      the session worklist (which files still lack a note — a flow does not
 *      count), and the durable worklist trimmed/cleared;
 *   3. the whole burst of `.raw` appends lands together, so the keeper coalesces
 *      to a single notes-index refresh + mechanical symbol backfill.
 *
 * "Write valid, report invalid": every well-formed note is written; malformed
 * ones and unresolved reuse-gate hits are collected and reported. Nothing is
 * atomic — a bad note never silences a good one. A single spec object is a batch
 * of one, so the callers have exactly one code path.
 */
import { kbWrite } from './write.js';
import type { WriteSpec, WriteOptions, WriteCandidate } from './write.js';
import { loadNote } from './store.js';
import { flowStepsWarning, flowEvidenceWarning, missingFieldsWarning } from './write-guide.js';
import { specPaths, finalizeBatchCoverage } from './durable-worklist.js';

export interface WriteOutcome {
  index: number;
  status: 'written' | 'candidates' | 'error';
  /** A human label for the spec (path, else title, else position). */
  label: string;
  id?: string;
  op?: string;
  candidates?: WriteCandidate[];
  message?: string;
  warnings?: string[];
}

export interface BatchResult {
  outcomes: WriteOutcome[];
  written: number;
  errors: number;
  candidates: number;
  coverage: string | null;
}

function specLabel(spec: WriteSpec, i: number): string {
  const s = spec as { title?: string; path?: string };
  return s.path || s.title || `spec #${i + 1}`;
}

async function writeOne(root: string, spec: WriteSpec, opts: WriteOptions, i: number): Promise<WriteOutcome> {
  const label = specLabel(spec, i);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { index: i, status: 'error', label, message: 'spec must be a JSON object' };
  }
  let wres;
  try {
    wres = await kbWrite(root, spec, opts);
  } catch (e) {
    return { index: i, status: 'error', label, message: e instanceof Error ? e.message : String(e) };
  }
  if (wres.status === 'error') return { index: i, status: 'error', label, message: wres.message };
  if (wres.status === 'candidates') {
    return { index: i, status: 'candidates', label, candidates: wres.candidates, message: wres.message };
  }
  const warnings = [...(wres.warnings ?? [])];
  const after = loadNote(root, wres.id).note;
  const stepsWarn = flowStepsWarning(spec, after);
  if (stepsWarn) warnings.push(stepsWarn);
  const missingWarn = missingFieldsWarning(spec, wres.id, after);
  if (missingWarn) warnings.push(missingWarn);
  const flowWarn = flowEvidenceWarning(spec, opts.session);
  if (flowWarn) warnings.push(flowWarn);
  return {
    index: i, status: 'written', label, id: wres.id, op: wres.op,
    warnings: warnings.length ? warnings : undefined,
  };
}

export async function kbWriteBatch(root: string, specs: WriteSpec[], opts: WriteOptions = {}): Promise<BatchResult> {
  const outcomes: WriteOutcome[] = [];
  for (let i = 0; i < specs.length; i++) {
    outcomes.push(await writeOne(root, specs[i], opts, i));
  }
  const writtenFilePaths = outcomes.flatMap((o) => (o.status === 'written' ? specPaths(specs[o.index]) : []));
  const coverage = finalizeBatchCoverage(root, writtenFilePaths, opts.session, opts.agent);
  return {
    outcomes,
    written: outcomes.filter((o) => o.status === 'written').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    candidates: outcomes.filter((o) => o.status === 'candidates').length,
    coverage,
  };
}
