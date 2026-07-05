/**
 * The `.raw` log — append + tolerant read of `.coldstart/notebook/.raw/<id>.jsonl`.
 *
 * Append is the ONLY writer of records; it stamps `v` and `ts` and injects a
 * live hash for every path the agent marked `verified` (the agent never writes
 * a hash). Read is tolerant: bad JSON lines and structurally-invalid records
 * are skipped with a warning, never a hard error — the log is a forever-format
 * shared across coldstart versions and git branches.
 */
import { readFileSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NewRecordInput, RawRecord, Anchor } from './types.js';
import { hashFile } from './freshness.js';
import { isValidId } from './ids.js';

export const KB_RAW_VERSION = 1;

export function notebookDir(root: string): string {
  return join(root, '.coldstart', 'notebook');
}
export function rawDir(root: string): string {
  return join(notebookDir(root), '.raw');
}
export function rawPath(root: string, id: string): string {
  return join(rawDir(root), `${id}.jsonl`);
}

/**
 * Stamp `v`/`ts`, inject hashes for `verified` paths, append one line.
 * Returns the record as written. Throws on an invalid envelope — append is the
 * write gate; tolerance belongs to the READ side.
 */
export function appendRecord(root: string, input: NewRecordInput): RawRecord {
  if (!input.id || !isValidId(input.id)) throw new Error(`invalid note id: ${JSON.stringify(input.id)}`);
  if (!['file', 'flow', 'lesson'].includes(input.type)) throw new Error(`invalid note type: ${JSON.stringify(input.type)}`);
  if (!['put', 'retract', 'supersede'].includes(input.op)) throw new Error(`invalid op: ${JSON.stringify(input.op)}`);

  const record: RawRecord = { ...input, v: KB_RAW_VERSION, ts: new Date().toISOString() };

  if (record.op === 'put' && Array.isArray(record.verified) && record.verified.length) {
    const anchors: Anchor[] = Array.isArray(record.anchors) ? record.anchors.map((a) => ({ ...a })) : [];
    for (const rel of record.verified) {
      const hash = hashFile(root, rel);
      const existing = anchors.find((a) => a.path === rel);
      if (existing) existing.hash = hash;
      else anchors.push({ path: rel, hash });
    }
    record.anchors = anchors;
  }

  mkdirSync(rawDir(root), { recursive: true });
  appendFileSync(rawPath(root, record.id), JSON.stringify(record) + '\n');
  return record;
}

export interface ReadLogResult {
  /** Parsed objects in file order — structural validation happens in fold(). */
  records: unknown[];
  warnings: string[];
}

/** Tolerant line-by-line read. Missing file → empty log (not an error). */
export function readLog(root: string, id: string): ReadLogResult {
  const records: unknown[] = [];
  const warnings: string[] = [];
  let text = '';
  try {
    text = readFileSync(rawPath(root, id), 'utf8');
  } catch {
    return { records, warnings };
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      warnings.push(`${id}.jsonl line ${i + 1}: unparseable JSON — skipped`);
    }
  }
  return { records, warnings };
}

/** All note ids present in the raw dir (one log file per note). */
export function listIds(root: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(rawDir(root));
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.slice(0, -'.jsonl'.length))
    .sort();
}
