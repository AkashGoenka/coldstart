/**
 * hooks/embed-model.mjs — pinned, verified, resumable model download. Local http server only (never the network).
 * Fixtures carry REAL hashes of both kinds (git blob sha1 for small files, sha256 for large) — a past version
 * checked gitsha1 as plain sha1 and could never install the real model while its tests passed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
// @ts-ignore — plain ESM hook module
import { ensureModel, modelStatus, REVISION } from "../hooks/embed-model.mjs";

const big = Buffer.alloc(3 << 20); for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
const small = Buffer.from('{"model":"fake"}');
const gitsha1 = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const BODY: Record<string, Buffer> = { "config.json": small, "onnx/w.bin": big };
const FILES = [
  { path: "config.json", size: small.length, gitsha1: gitsha1(small) },
  { path: "onnx/w.bin", size: big.length, sha256: sha256(big) },
];

type Mode = "normal" | "ignore-range" | "drop-half" | "corrupt";
let server: Server, base: string, dir: string, mode: Mode, log: { path: string; range?: string; bytes: number }[];
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "em-")); mode = "normal"; log = [];
  server = createServer((req, res) => {
    const path = decodeURIComponent(req.url!.slice(1)), body = BODY[path];
    const range = req.headers.range as string | undefined, entry = { path, range, bytes: 0 };
    log.push(entry);
    if (!body) { res.writeHead(404).end(); return; }
    let data = mode === "corrupt" ? Buffer.from(body.map((x) => x ^ 1)) : body, status = 200;
    const m = range && mode !== "ignore-range" ? /^bytes=(\d+)-$/.exec(range) : null;
    if (m) {
      const start = +m[1];
      if (start >= body.length) { res.writeHead(416).end(); return; }
      data = data.subarray(start); status = 206;
    }
    res.writeHead(status, { "content-length": data.length });
    if (mode === "drop-half" && data.length > 1 << 20) { entry.bytes = data.length >> 1; res.write(data.subarray(0, data.length >> 1), () => res.socket?.destroy()); return; }
    entry.bytes = data.length; res.end(data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/`;
});
afterEach(async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
const run = (extra: object = {}) => ensureModel({ dir, files: FILES, baseUrl: base, ...extra });
const good = () => FILES.every((f) => existsSync(join(dir, f.path)) && readFileSync(join(dir, f.path)).equals(BODY[f.path]));

describe("ensureModel", () => {
  it("downloads and verifies both hash kinds; progress is throttled and ends at the total", async () => {
    const seen: any[] = [];
    await run({ onProgress: (p: any) => seen.push(p) });
    expect(good()).toBe(true);
    expect(seen.length).toBeLessThan(20);
    expect(seen.at(-1)).toMatchObject({ overallHave: small.length + big.length, overallTotal: small.length + big.length });
    expect(modelStatus({ dir, files: FILES })).toMatchObject({ ready: true, missing: [] });
  });

  it("verifies once: a second call makes no request and does not re-hash", async () => {
    await run(); log = [];
    const p = join(dir, "onnx/w.bin"), b = readFileSync(p); b[0] ^= 0xff; writeFileSync(p, b); // same size, wrong bytes
    await run();
    expect(log).toEqual([]); // trusted the verified record → no hashing, no fetch
  });

  it("files already present but never verified (an older coldstart) are hashed, not re-downloaded", async () => {
    mkdirSync(join(dir, "onnx"), { recursive: true });
    for (const f of FILES) writeFileSync(join(dir, f.path), BODY[f.path]);
    await run();
    expect(log).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, ".verified.json"), "utf8"))[REVISION]).toMatchObject({ "config.json": true, "onnx/w.bin": true });
  });

  it("a corrupt .verified.json (valid JSON of the wrong shape) means re-hash, not a crash", async () => {
    await run();
    for (const junk of ["null", '"s"', "[1]", `{"${REVISION}":null}`]) { writeFileSync(join(dir, ".verified.json"), junk); await run(); expect(good()).toBe(true); }
  });

  it("resumes a REAL interrupted download with a Range request", async () => {
    mode = "drop-half";
    await expect(run()).rejects.toThrow();
    const part = join(dir, "onnx/w.bin.part");
    expect(statSync(part).size).toBeGreaterThan(0);
    expect(existsSync(join(dir, "onnx/w.bin"))).toBe(false);
    const had = statSync(part).size; mode = "normal"; log = [];
    await run();
    expect(good()).toBe(true);
    expect(log).toEqual([{ path: "onnx/w.bin", range: `bytes=${had}-`, bytes: big.length - had }]);
  });

  it("a server ignoring Range (200) restarts the file cleanly", async () => {
    mkdirSync(join(dir, "onnx"), { recursive: true });
    writeFileSync(join(dir, "onnx/w.bin.part"), big.subarray(0, 1000));
    mode = "ignore-range";
    await run();
    expect(good()).toBe(true);
  });

  it("a full-size .part is verified without a request; a bogus one past the end (416) restarts", async () => {
    mkdirSync(join(dir, "onnx"), { recursive: true });
    writeFileSync(join(dir, "onnx/w.bin.part"), big);
    await run();
    expect(log.filter((e) => e.path === "onnx/w.bin")).toEqual([]);
    rmSync(join(dir, "onnx/w.bin")); rmSync(join(dir, ".verified.json"));
    writeFileSync(join(dir, "onnx/w.bin.part"), Buffer.alloc(big.length + 10)); // oversize → deleted, fresh fetch
    await run();
    expect(good()).toBe(true);
  });

  it("hash mismatch: throws, nothing under the final name, .part discarded", async () => {
    mode = "corrupt";
    await expect(run()).rejects.toThrow(/hash mismatch/);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
    expect(existsSync(join(dir, "config.json.part"))).toBe(false);
  });

  it("right-size file with wrong bytes at the final name → re-downloaded", async () => {
    writeFileSync(join(dir, "config.json"), Buffer.alloc(small.length));
    await run();
    expect(good()).toBe(true);
  });
});

describe("download lock", () => {
  const lock = () => join(dir, ".download.lock");
  it("a LIVE holder → EBUSY (by code), and the holder's lock is left alone", async () => {
    const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
    try {
      writeFileSync(lock(), String(holder.pid));
      await expect(run()).rejects.toMatchObject({ code: "EBUSY" });
      expect(readFileSync(lock(), "utf8")).toBe(String(holder.pid));
    } finally { holder.kill(); }
  });
  it("a DEAD holder's lock is taken over at once (fresh mtime, no 10-minute wait)", async () => {
    const dead = spawn(process.execPath, ["-e", ""]); await new Promise((r) => dead.on("exit", r));
    writeFileSync(lock(), String(dead.pid));
    await run();
    expect(good()).toBe(true);
    expect(existsSync(lock())).toBe(false);
  });
  it("a live holder whose lock went stale (no heartbeat for > 10 min) is taken over", async () => {
    const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"]);
    try {
      writeFileSync(lock(), String(holder.pid)); const old = new Date(Date.now() - 11 * 60_000); utimesSync(lock(), old, old);
      await run();
      expect(good()).toBe(true);
    } finally { holder.kill(); }
  });
  it("the lock is released on failure and on abort", async () => {
    mode = "corrupt"; await expect(run()).rejects.toThrow(); expect(existsSync(lock())).toBe(false);
    mode = "normal"; const ac = new AbortController(); ac.abort();
    await expect(run({ signal: ac.signal })).rejects.toThrow(); expect(existsSync(lock())).toBe(false);
  });
});
