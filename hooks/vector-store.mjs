// Per-repo vector store for the embedder daemon (docs/embedder-daemon-design.md §3). Sync fs throughout: the
// writer is one daemon doing small batches; readers (find, hooks) do a handful of positioned reads per call.
//
//   dir/seg-NNNNNN.bin   rows [16-byte key][dim × f32], IMMUTABLE once listed in the manifest
//   dir/seg-NNNNNN.idx   sorted [16-byte key][u32 row] for that segment
//   dir/manifest.json    {storeVersion, recipe, dim, nextSeg, segments:[{name, rows}], lastSweepDay}
//   dir/refs.json        {keyHex: {kind, id, lastSeenDay}} — one entry per stored row
//
// Safety rules: segment names only ever increase (nextSeg), so nothing is renamed over a file a reader may hold;
// the manifest is written last (tmp + rename); readers never write or delete anything and verify the key stored
// in every row they return; only the writer (openWriter) cleans orphans. A crash leaves at worst unlisted files.
import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STORE_VERSION = 1;
const KEY = 16, IDX_ROW = KEY + 4;
const SEG_RE = /^seg-(\d{6})\.(bin|idx)$/;
const segName = (n) => `seg-${String(n).padStart(6, "0")}`;

/** 16-byte key = sha256 over every input that changes the vector. Returned as lowercase hex (32 chars). */
export function vectorKey({ recipeVersion, modelId, dtype, role, text }) {
  return createHash("sha256").update([recipeVersion, modelId, dtype, role, text].join("\0")).digest("hex").slice(0, KEY * 2);
}
const keyBuf = (hex) => { if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`bad vector key: ${hex}`); return Buffer.from(hex, "hex"); };

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function writeAtomic(p, data) {
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try { renameSync(tmp, p); return; } catch (e) {
      // Windows: rename over a file another process has open can fail transiently
      if (i >= 4 || (e.code !== "EPERM" && e.code !== "EACCES" && e.code !== "EBUSY")) throw e;
      const until = Date.now() + 20 * (i + 1); while (Date.now() < until) { /* brief spin */ }
    }
  }
}
const validManifest = (m, recipe, dim) => m && m.storeVersion === STORE_VERSION && m.recipe === recipe && m.dim === dim &&
  Array.isArray(m.segments) && m.segments.every((s) => /^seg-\d{6}$/.test(s.name) && Number.isInteger(s.rows));
const emptyManifest = (recipe, dim) => ({ storeVersion: STORE_VERSION, recipe, dim, nextSeg: 0, segments: [], lastSweepDay: 0 });

// ---------------------------------------------------------------- reader (any process; never writes)

/** Read-only handle. Picks up the writer's new manifests automatically (cheap stat per call). */
export function openReader(dir, { recipe, dim = 768 }) {
  if (typeof recipe !== "string" || !recipe) throw new Error("openReader: recipe must be a non-empty string");
  const mp = join(dir, "manifest.json");
  let man = emptyManifest(recipe, dim), manMtime = "";
  const idxCache = new Map(); // segment name → Buffer (segments are immutable, so a cached idx never goes stale)

  function refresh(force = false) {
    // rename → new inode, so ino+mtime+size changes even on filesystems with coarse mtimes
    let mt; try { const st = statSync(mp); mt = `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { man = emptyManifest(recipe, dim); manMtime = ""; return; }
    if (!force && mt === manMtime) return;
    const m = readJson(mp);
    if (m === null) return; // transient read failure (e.g. Windows mid-rename): keep the last good manifest, retry next call
    man = validManifest(m, recipe, dim) ? m : emptyManifest(recipe, dim);
    manMtime = mt;
    const live = new Set(man.segments.map((s) => s.name));
    for (const k of idxCache.keys()) if (!live.has(k)) idxCache.delete(k);
  }
  function idxOf(name) {
    let b = idxCache.get(name);
    if (!b) { b = readFileSync(join(dir, name + ".idx")); idxCache.set(name, b); }
    return b;
  }
  function find(idx, kb) { // binary search → row number or -1
    let lo = 0, hi = idx.length / IDX_ROW - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, c = idx.compare(kb, 0, KEY, mid * IDX_ROW, mid * IDX_ROW + KEY);
      if (c === 0) return idx.readUInt32LE(mid * IDX_ROW + KEY);
      if (c < 0) lo = mid + 1; else hi = mid - 1; // c = idx entry vs wanted key
    }
    return -1;
  }
  // One missing segment costs only its own rows (reported via `missing`), never the whole read.
  function attempt(hexKeys, out) {
    const rowBytes = KEY + 4 * man.dim, want = new Map(hexKeys.filter((h) => !out.has(h)).map((h) => [h, keyBuf(h)]));
    let missing = false;
    for (const seg of [...man.segments].reverse()) { // newest first
      if (!want.size) break;
      let idx, fd;
      try { idx = idxOf(seg.name); } catch (e) { if (e.code !== "ENOENT") throw e; missing = true; continue; }
      const hits = [];
      for (const [h, kb] of want) { const r = find(idx, kb); if (r >= 0) hits.push([h, kb, r]); }
      if (!hits.length) continue;
      try { fd = openSync(join(dir, seg.name + ".bin"), "r"); } catch (e) { if (e.code !== "ENOENT") throw e; missing = true; continue; }
      try {
        const buf = Buffer.allocUnsafe(rowBytes);
        for (const [h, kb, r] of hits) {
          if (readSync(fd, buf, 0, rowBytes, r * rowBytes) !== rowBytes || buf.compare(kb, 0, KEY, 0, KEY) !== 0) continue; // never return a wrong row
          const v = new Float32Array(man.dim);
          for (let j = 0; j < man.dim; j++) v[j] = buf.readFloatLE(KEY + 4 * j);
          out.set(h, v); want.delete(h);
        }
      } finally { closeSync(fd); }
    }
    return missing;
  }
  return {
    /** Map keyHex → Float32Array for the keys present. Never throws for a segment that vanished mid-read. */
    get(hexKeys) {
      refresh();
      const out = new Map();
      if (attempt(hexKeys, out)) { refresh(true); attempt(hexKeys, out); } // a compaction swapped segments: one retry
      return out;
    },
    has(hexKey) { return this.get([hexKey]).has(hexKey); },
    manifest() { refresh(); return man; },
  };
}

// ---------------------------------------------------------------- writer (the daemon only)

/** Single-writer handle. Cleans crash leftovers; a recipe/dim/version mismatch starts a fresh, empty store. */
export function openWriter(dir, { recipe, dim = 768 }) {
  if (typeof recipe !== "string" || !recipe) throw new Error("openWriter: recipe must be a non-empty string");
  mkdirSync(dir, { recursive: true });
  const mp = join(dir, "manifest.json"), rp = join(dir, "refs.json");
  let man = readJson(mp), refs;
  if (validManifest(man, recipe, dim)) refs = readJson(rp) ?? {};
  else { man = emptyManifest(recipe, dim); refs = {}; writeAtomic(rp, "{}"); writeAtomic(mp, JSON.stringify(man)); }
  cleanOrphans();
  const reader = openReader(dir, { recipe, dim });
  const rowBytes = KEY + 4 * dim;
  reconcileRefs();

  // refs.json and manifest.json are two files: a crash between their writes leaves them disagreeing. The
  // segments' idx files are the truth — drop refs with no row, give rows with no ref a day-0 ref (ages out).
  // A listed segment whose files are gone (deleted by hand, power loss) is dropped: only its rows are lost, and
  // dropping their refs lets append re-store them.
  function reconcileRefs() {
    const stored = new Set(), kept = [];
    for (const s of man.segments) {
      let idx;
      try { idx = readFileSync(join(dir, s.name + ".idx")); statSync(join(dir, s.name + ".bin")); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
      kept.push(s);
      for (let o = 0; o < idx.length; o += IDX_ROW) stored.add(idx.toString("hex", o, o + KEY));
    }
    if (kept.length !== man.segments.length) { man.segments = kept; writeAtomic(mp, JSON.stringify(man)); }
    let changed = false;
    for (const k of Object.keys(refs)) if (!stored.has(k)) { delete refs[k]; changed = true; }
    for (const k of stored) if (!refs[k]) { refs[k] = { kind: "unknown", id: "", lastSeenDay: 0 }; changed = true; }
    if (changed) writeAtomic(rp, JSON.stringify(refs));
  }

  function cleanOrphans() { // only our own file shapes, only inside dir
    const live = new Set(man.segments.map((s) => s.name));
    for (const f of readdirSync(dir)) {
      const m = SEG_RE.exec(f);
      const orphanSeg = m && !live.has(f.slice(0, 10));
      if (orphanSeg || /^(manifest|refs)\.json\.\d+\.tmp$/.test(f) || /^seg-\d{6}\.(bin|idx)\.\d+\.tmp$/.test(f)) {
        try { unlinkSync(join(dir, f)); } catch { /* Windows: still open — next sweep */ }
      }
    }
  }
  function writeSegment(rows) { // rows: [{kb, vec}] → new segment name (files complete, NOT yet in manifest)
    const name = segName(man.nextSeg++);
    const bin = Buffer.allocUnsafe(rows.length * rowBytes), idx = Buffer.allocUnsafe(rows.length * IDX_ROW);
    rows.forEach((r, i) => {
      r.kb.copy(bin, i * rowBytes);
      for (let j = 0; j < dim; j++) bin.writeFloatLE(r.vec[j], i * rowBytes + KEY + 4 * j);
    });
    const order = rows.map((_, i) => i).sort((a, b) => rows[a].kb.compare(rows[b].kb));
    order.forEach((r, i) => { rows[r].kb.copy(idx, i * IDX_ROW); idx.writeUInt32LE(r, i * IDX_ROW + KEY); });
    writeAtomic(join(dir, name + ".bin"), bin); writeAtomic(join(dir, name + ".idx"), idx);
    return name;
  }
  const commit = () => { writeAtomic(rp, JSON.stringify(refs)); writeAtomic(mp, JSON.stringify(man)); }; // manifest LAST
  const totalRows = () => man.segments.reduce((a, s) => a + s.rows, 0);

  return {
    get: (keys) => reader.get(keys),
    has: (key) => reader.has(key),
    /** Every stored key (refs ↔ rows are 1:1 after reconcile) — lets the daemon diff without reading vectors. */
    storedKeys: () => new Set(Object.keys(refs)),
    /** rows: [{key, vec: Float32Array(dim), kind: 'file'|'note', id, day}] — already-stored keys are skipped. */
    append(rows) {
      const seen = new Set(), fresh = [];
      for (const r of rows) {
        if (!(r.vec instanceof Float32Array) || r.vec.length !== dim) throw new Error(`append: vector must be Float32Array(${dim})`);
        if ((r.kind !== "file" && r.kind !== "note") || typeof r.id !== "string" || !Number.isInteger(r.day)) throw new Error("append: kind ('file'|'note'), id (string) and day (integer) required");
        if (seen.has(r.key) || refs[r.key]) continue; // every stored row has a ref, so refs is the membership set
        seen.add(r.key); fresh.push({ kb: keyBuf(r.key), vec: r.vec, ref: { kind: r.kind, id: r.id, lastSeenDay: r.day } });
      }
      if (!fresh.length) return 0;
      const name = writeSegment(fresh);
      fresh.forEach((r) => (refs[r.kb.toString("hex")] = r.ref));
      man.segments.push({ name, rows: fresh.length });
      commit();
      return fresh.length;
    },
    /** Stamp lastSeenDay on keys that are in the repo's CURRENT sketches/notebook. Writes only if something changed. */
    markSeen(keys, day) {
      let changed = false;
      for (const k of keys) { const r = refs[k]; if (r && r.lastSeenDay < day) { r.lastSeenDay = day; changed = true; } }
      if (changed) writeAtomic(rp, JSON.stringify(refs));
      return changed;
    },
    /** Piggyback sweep (no cron): at most once per day. Dead = not in currentKeys AND unseen for graceDays. */
    maybeSweep({ today, currentKeys, graceDays = 30, deadFrac = 0.3, maxSegments = 64 }) {
      if (today - man.lastSweepDay < 1) return { ran: false };
      man.lastSweepDay = today;
      const dead = new Set(Object.keys(refs).filter((k) => !currentKeys.has(k) && today - refs[k].lastSeenDay > graceDays));
      const rows = totalRows();
      if (!(rows && dead.size / rows > deadFrac) && man.segments.length <= maxSegments) {
        writeAtomic(mp, JSON.stringify(man)); cleanOrphans(); // dead rows are kept (and counted) until a compaction
        return { ran: true, compacted: false, dead: dead.size, rows };
      }
      const liveKeys = Object.keys(refs).filter((k) => !dead.has(k));
      const vecs = reader.get(liveKeys), live = liveKeys.filter((k) => vecs.has(k));
      const old = man.segments;
      man.segments = live.length ? [{ name: writeSegment(live.map((k) => ({ kb: keyBuf(k), vec: vecs.get(k) }))), rows: live.length }] : [];
      for (const k of Object.keys(refs)) if (!vecs.has(k) || dead.has(k)) delete refs[k];
      commit();
      for (const s of old) for (const ext of [".bin", ".idx"]) { try { unlinkSync(join(dir, s.name + ext)); } catch { /* open on Windows → cleanOrphans later */ } }
      return { ran: true, compacted: true, dead: dead.size, rows: live.length };
    },
    stats() {
      let bytes = 0;
      for (const s of man.segments) for (const ext of [".bin", ".idx"]) { try { bytes += statSync(join(dir, s.name + ext)).size; } catch { /* gone */ } }
      return { rows: totalRows(), segments: man.segments.length, refs: Object.keys(refs).length, bytes };
    },
  };
}
