/**
 * hooks/vector-store.mjs — the embedder daemon's per-repo vector store. Every behavioural assert goes through
 * get(): the manifest/stats can look right while the data is gone (a past version deleted its own compacted
 * segment and these tests' predecessors passed). Vectors are a deterministic function of their key, so any
 * wrong row returned is detected.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-ignore — plain ESM hook module
import { openReader, openWriter, vectorKey } from "../hooks/vector-store.mjs";

const DIM = 8, R = "r1";
const STORE = fileURLToPath(new URL("../hooks/vector-store.mjs", import.meta.url));
const key = (i: number) => vectorKey({ recipeVersion: 1, modelId: "m", dtype: "q4", role: "doc", text: `t${i}` });
const vecFor = (k: string) => { const s = parseInt(k.slice(0, 8), 16); return Float32Array.from({ length: DIM }, (_, j) => ((s + j * 7919) % 100003) / 100003); };
const row = (i: number, day = 1) => { const k = key(i); return { key: k, vec: vecFor(k), kind: "file", id: `f${i}`, day }; };
const same = (a: Float32Array | undefined, b: Float32Array) => !!a && a.length === b.length && a.every((x, j) => x === b[j]);
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vs-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const W = () => openWriter(dir, { recipe: R, dim: DIM });
const Rd = () => openReader(dir, { recipe: R, dim: DIM });
const expectAll = (h: any, ids: number[]) => { const got = h.get(ids.map(key)); for (const i of ids) expect(same(got.get(key(i)), vecFor(key(i))), `row ${i}`).toBe(true); };
const expectNone = (h: any, ids: number[]) => expect(h.get(ids.map(key)).size).toBe(0);

describe("vectorKey", () => {
  it("is 32 hex chars and changes with every input", () => {
    const base = { recipeVersion: 1, modelId: "m", dtype: "q4", role: "doc", text: "x" };
    expect(vectorKey(base)).toMatch(/^[0-9a-f]{32}$/);
    for (const [f, v] of [["recipeVersion", 2], ["modelId", "n"], ["dtype", "q8"], ["role", "query"], ["text", "y"]])
      expect(vectorKey({ ...base, [f as string]: v })).not.toBe(vectorKey(base));
  });
});

describe("append / get", () => {
  it("round-trips exactly across many segments, incl. absent keys and idx boundaries", () => {
    const w = W();
    for (let s = 0; s < 10; s++) w.append(range(s * 500, s * 500 + 500).map((i) => row(i)));
    expectAll(w, [0, 499, 500, 2500, 4999, ...range(1000, 1100)]);
    expectNone(w, [5000, 9999]);
    expectAll(Rd(), range(0, 5000));
  });
  it("skips keys already stored and duplicates inside a batch", () => {
    const w = W();
    expect(w.append([row(1), row(1), row(2)])).toBe(2);
    expect(w.append([row(2), row(3)])).toBe(1);
    expect(w.stats().rows).toBe(3);
    expectAll(w, [1, 2, 3]);
  });
  it("rejects wrong-dimension vectors and malformed keys", () => {
    const w = W();
    expect(() => w.append([{ ...row(1), vec: new Float32Array(DIM + 1) }])).toThrow();
    expect(() => w.append([{ ...row(1), key: "abc" }])).toThrow();
    expect(w.stats().rows).toBe(0);
  });
  it("a reader handle opened BEFORE an append sees the appended rows", () => {
    const w = W(), r = Rd();
    expectNone(r, [1]);
    w.append([row(1)]);
    expectAll(r, [1]);
  });
  it("persists across reopen", () => {
    W().append(range(0, 50).map((i) => row(i)));
    expectAll(W(), range(0, 50));
  });
});

describe("crash leftovers and mismatches", () => {
  it("an unlisted segment is ignored by readers, left alone by readers, and removed by the writer", () => {
    const w = W(); w.append([row(1)]);
    writeFileSync(join(dir, "seg-000099.bin"), "junk"); writeFileSync(join(dir, "seg-000099.idx"), "junk");
    writeFileSync(join(dir, "manifest.json.123.tmp"), "{");
    expectAll(Rd(), [1]);
    expect(existsSync(join(dir, "seg-000099.bin"))).toBe(true); // readers never delete
    W();
    expect(readdirSync(dir).sort()).toEqual(["manifest.json", "refs.json", "seg-000000.bin", "seg-000000.idx"]);
  });
  it("refs/manifest disagreement after a crash is reconciled from the idx files", () => {
    const w = W(); w.append([row(1)]);
    const refs = JSON.parse(readFileSync(join(dir, "refs.json"), "utf8"));
    refs[key(2)] = { kind: "file", id: "ghost", lastSeenDay: 1 }; // ref written, its manifest never was
    delete refs[key(1)]; // row stored, its ref lost
    writeFileSync(join(dir, "refs.json"), JSON.stringify(refs));
    const w2 = W();
    expect(w2.append([row(2)])).toBe(1); // ghost ref no longer blocks storing key 2
    expectAll(w2, [1, 2]);
    expect(w2.stats().refs).toBe(2);
  });
  it("recipe change → fresh empty store, durably; the old recipe can't resurrect old rows", () => {
    W().append([row(1)]);
    const w2 = openWriter(dir, { recipe: "r2", dim: DIM });
    expect(w2.stats()).toMatchObject({ rows: 0, refs: 0 });
    expectNone(openReader(dir, { recipe: "r2", dim: DIM }), [1]);
    expectNone(Rd(), [1]);
    expect(W().stats()).toMatchObject({ rows: 0, refs: 0 });
  });
  it("a manifest naming a file outside the store is rejected, and nothing outside is deleted", () => {
    const victim = join(dir, "..", `victim-${Date.now()}.bin`); writeFileSync(victim, "keep");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ storeVersion: 1, recipe: R, dim: DIM, nextSeg: 1, segments: [{ name: "../victim", rows: 1 }], lastSweepDay: 0 }));
    expectNone(Rd(), [1]);
    W();
    expect(existsSync(victim)).toBe(true);
    rmSync(victim);
  });
  it("recipe must be a non-empty string (an object would compare unequal on every open)", () => {
    for (const recipe of [undefined, "", { v: 1 }]) {
      expect(() => openReader(dir, { recipe } as any)).toThrow();
      expect(() => openWriter(dir, { recipe } as any)).toThrow();
    }
  });
  it("append rejects rows without kind/id/day (such a row could never age out)", () => {
    const w = W(), k = key(1);
    expect(() => w.append([{ key: k, vec: vecFor(k) }])).toThrow();
    expect(() => w.append([{ ...row(1), kind: "x" }])).toThrow();
    expect(() => w.append([{ ...row(1), day: 1.5 }])).toThrow();
    expect(w.stats().rows).toBe(0);
  });
  it("a missing .bin loses only that segment's rows; the writer drops it and re-append heals", () => {
    const w = W(); w.append(range(0, 5).map((i) => row(i))); w.append(range(5, 10).map((i) => row(i)));
    rmSync(join(dir, "seg-000000.bin"));
    expectAll(Rd(), range(5, 10)); expectNone(Rd(), range(0, 5));
    const w2 = W();
    expect(w2.stats()).toMatchObject({ segments: 1, refs: 5 });
    expect(w2.append(range(0, 10).map((i) => row(i)))).toBe(5);
    expectAll(w2, range(0, 10));
  });
  it("a missing .idx doesn't stop the writer opening", () => {
    const w = W(); w.append([row(1)]); w.append([row(2)]);
    rmSync(join(dir, "seg-000001.idx"));
    expectAll(Rd(), [1]);
    const w2 = W();
    expectAll(w2, [1]);
    expect(w2.append([row(2)])).toBe(1);
    expectAll(w2, [1, 2]);
  });
  it("a different dim on open starts fresh", () => {
    W().append([row(1)]);
    expect(openWriter(dir, { recipe: R, dim: DIM * 2 }).stats().rows).toBe(0);
  });
});

describe("piggyback sweep", () => {
  it("runs at most once per day", () => {
    const w = W(); w.append([row(1)]);
    expect(w.maybeSweep({ today: 10, currentKeys: new Set() }).ran).toBe(true);
    expect(w.maybeSweep({ today: 10, currentKeys: new Set() }).ran).toBe(false);
    expect(w.maybeSweep({ today: 11, currentKeys: new Set() }).ran).toBe(true);
  });
  it("branch switch: unreferenced rows survive within the 30-day grace", () => {
    const w = W(); w.append(range(0, 10).map((i) => row(i, 100)));
    expect(w.maybeSweep({ today: 130, currentKeys: new Set() }).compacted).toBe(false);
    expectAll(w, range(0, 10));
  });
  it("after the grace, dead rows go and live rows still read back correctly", () => {
    const w = W();
    for (let s = 0; s < 3; s++) w.append(range(s * 4, s * 4 + 4).map((i) => row(i, 1)));
    w.markSeen(range(0, 6).map(key), 50);
    const res = w.maybeSweep({ today: 50, currentKeys: new Set(range(0, 6).map(key)) });
    expect(res).toMatchObject({ compacted: true, rows: 6 });
    expectAll(w, range(0, 6)); expectAll(Rd(), range(0, 6)); expectAll(W(), range(0, 6));
    expectNone(w, range(6, 12));
    expect(readdirSync(dir).filter((f) => f.endsWith(".bin"))).toEqual(["seg-000003.bin"]); // new name, olds gone
  });
  it("rows dying a few at a time accumulate until the 30% threshold compacts them", () => {
    const w = W(); w.append(range(0, 100).map((i) => row(i, 1)));
    let alive = range(0, 100), compacted = -1;
    for (let d = 0; d < 6 && compacted < 0; d++) {
      alive = alive.slice(10);
      const today = 40 + d; // every row was last seen on day 1, so each newly-dead row is already past grace
      if (w.maybeSweep({ today, currentKeys: new Set(alive.map(key)) }).compacted) compacted = d;
    }
    expect(compacted).toBe(3); // 40 dead of 100 > 30%
    expectAll(w, alive);
    expect(w.stats().rows).toBe(alive.length);
  });
  it("too many segments → compaction even with nothing dead, keeping every row", () => {
    const w = W();
    for (let i = 0; i < 6; i++) w.append([row(i, 5)]);
    expect(w.maybeSweep({ today: 6, currentKeys: new Set(range(0, 6).map(key)), maxSegments: 4 }).compacted).toBe(true);
    expect(w.stats().segments).toBe(1);
    expectAll(w, range(0, 6));
  });
  it("a non-compacting sweep persists lastSweepDay across reopen", () => {
    const w = W(); w.append([row(1, 5)]);
    expect(w.maybeSweep({ today: 6, currentKeys: new Set([key(1)]) })).toMatchObject({ ran: true, compacted: false });
    expect(W().maybeSweep({ today: 6, currentKeys: new Set([key(1)]) }).ran).toBe(false);
  });
  it("markSeen rewrites refs only when a day actually advances", () => {
    const w = W(); w.append([row(1, 5)]);
    expect(w.markSeen([key(1)], 5)).toBe(false);
    expect(w.markSeen([key(1)], 6)).toBe(true);
    expect(w.markSeen([key(1)], 6)).toBe(false);
  });
});

// ---- other processes ----
const child = (code: string) => spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
const keyFn = `const vectorKey=s.vectorKey, key=(i)=>vectorKey({recipeVersion:1,modelId:"m",dtype:"q4",role:"doc",text:"t"+i});
  const vecFor=(k)=>{const x=parseInt(k.slice(0,8),16);return Float32Array.from({length:${DIM}},(_,j)=>((x+j*7919)%100003)/100003)};`;

describe("cross-process", () => {
  it("a reader in another process never throws and never gets a wrong vector while the writer appends and compacts", async () => {
    const w = W(); w.append(range(0, 200).map((i) => row(i, 1)));
    const c = child(`const s=await import(${JSON.stringify(STORE)}); ${keyFn}
      const r=s.openReader(${JSON.stringify(dir)},{recipe:"${R}",dim:${DIM}}); let gets=0,wrong=0,err=0,missingLive=0; const end=Date.now()+1500;
      const live=Array.from({length:50},(_,i)=>key(i));
      while(Date.now()<end){ try{ const ks=[...Array.from({length:20},()=>key(Math.floor(Math.random()*400))),...live.slice(0,10)]; const m=r.get(ks);
        for(const k of live.slice(0,10)) if(!m.has(k)) missingLive++;
        for(const [k,v] of m){ const e=vecFor(k); if(!v.every((x,j)=>x===e[j])) wrong++; } gets++; }catch(e){err++; console.error(String(e))} }
      console.log(JSON.stringify({gets,wrong,err,missingLive}));`);
    let out = ""; c.stdout.on("data", (d) => (out += d));
    const done = new Promise((res) => c.on("exit", res));
    for (let d = 2; d < 40; d++) { // appends + markSeen + daily sweeps with rows dying → several compactions
      w.append(range(200 + (d - 2) * 5, 200 + (d - 1) * 5).map((i) => row(i, d)));
      const cur = [...range(0, 50), ...range(50 + d * 5, 400)].map(key); // 0..49 always live; others die over time
      w.markSeen(cur, d + 40);
      w.maybeSweep({ today: d + 40, currentKeys: new Set(cur), maxSegments: 3 });
      await new Promise((r) => setTimeout(r, 20));
    }
    await done;
    const res = JSON.parse(out.trim().split("\n").pop()!);
    expect(res.gets).toBeGreaterThan(50);
    expect(res).toMatchObject({ wrong: 0, err: 0, missingLive: 0 });
  }, 20000);

  it("SIGKILL of the writer mid-work leaves a consistent store with every listed row intact", async () => {
    for (let round = 0; round < 4; round++) {
      const c = child(`const s=await import(${JSON.stringify(STORE)}); ${keyFn}
        const w=s.openWriter(${JSON.stringify(dir)},{recipe:"${R}",dim:${DIM}}); let i=${round * 100000}, d=1; const all=new Set();
        console.log("go");
        for(;;){ const rows=[]; for(let j=0;j<20;j++){const k=key(i++); all.add(k); rows.push({key:k,vec:vecFor(k),kind:"file",id:"x",day:d});}
          w.append(rows); d++; w.maybeSweep({today:d,currentKeys:all,maxSegments:2}); }`);
      await new Promise((res) => c.stdout.once("data", res));
      await new Promise((r) => setTimeout(r, 150 + round * 70));
      c.kill("SIGKILL");
      await new Promise((res) => c.on("exit", res));
      const w = W(); // reopen: cleans leftovers, reconciles refs
      const man = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      const files = readdirSync(dir);
      for (const s of man.segments) { expect(files).toContain(s.name + ".bin"); expect(files).toContain(s.name + ".idx"); }
      expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
      const refs = Object.keys(JSON.parse(readFileSync(join(dir, "refs.json"), "utf8")));
      const got = w.get(refs);
      expect(refs.length).toBeGreaterThan(round * 20); // earlier rounds' rows are all still there (nothing ever died)
      expect(got.size).toBe(refs.length);
      for (const [k, v] of got) expect(same(v, vecFor(k))).toBe(true);
    }
  }, 30000);
});
