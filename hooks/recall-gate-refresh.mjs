#!/usr/bin/env node
/**
 * recall-gate-refresh.mjs <root> — DETACHED job that keeps the recall gate's
 * note vectors current (.coldstart/notebook/.gate/vectors.json).
 *
 * Spawned by recall-gate.mjs whenever a prompt finds a note without a vector
 * (new or edited note, first run, model not downloaded). The hook never waits
 * for it: that prompt falls back to BM25 recall, later prompts get the gate.
 * Downloads the q4 text model (~174 MB) on first run — the hook itself never
 * downloads. One job at a time (refresh.lock); vectors written atomically.
 */

// MUST stay the first import (hooks rule).
import "./regex-engine.mjs";
import { mkdirSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_ID, DTYPE, gateDir, vectorsPath, readActiveNotes, readVectorCache, loadEmbedder, takeRefreshLock, encodeVec } from "./recall-gate.mjs";

const root = process.argv[2];
const logFile = root ? join(root, ".coldstart", "kb-hook.log") : null;
const log = (m) => { try { if (logFile) appendFileSync(logFile, `[${new Date().toISOString()}] gate-refresh: ${m}\n`); } catch { /* never fail */ } };

(async () => {
  if (!root) process.exit(0);
  mkdirSync(gateDir(root), { recursive: true });
  const release = takeRefreshLock(root);
  if (!release) process.exit(0); // another refresh is running
  const t0 = Date.now();
  try {
    const notes = readActiveNotes(root);
    const cache = readVectorCache(root) ?? { model: MODEL_ID, dtype: DTYPE, notes: {} };
    const todo = notes.filter((n) => cache.notes[n.id]?.h !== n.hash);
    if (todo.length) {
      const embed = await loadEmbedder({ allowRemote: true });
      // One at a time: notes run to thousands of tokens and batching pads
      // every row to the longest one.
      for (const n of todo) {
        const [v] = await embed([n.text], "doc");
        cache.notes[n.id] = { h: n.hash, v: encodeVec(v) };
      }
    }
    // Drop vectors of notes that are gone or no longer active.
    const live = new Set(notes.map((n) => n.id));
    for (const id of Object.keys(cache.notes)) if (!live.has(id)) delete cache.notes[id];
    const tmp = vectorsPath(root) + `.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, vectorsPath(root));
    log(`embedded ${todo.length}/${notes.length} notes in ${Date.now() - t0} ms`);
  } catch (e) {
    log(`failed: ${e?.stack || e}`);
  } finally {
    release();
  }
  process.exit(0);
})();
