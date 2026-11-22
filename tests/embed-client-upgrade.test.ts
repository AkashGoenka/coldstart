/**
 * An OLDER-protocol embedder daemon that answers normally is replaced (hooks/embed-client.mjs replaceIfOlder): before,
 * the protocol was only checked when the daemon did NOT answer, so an old daemon kept serving after an update until
 * its idle exit. A fake daemon stands in for the old one; the spawned real daemon must ask it to stop. Same or newer
 * protocol → never touched. No model needed: the spawned daemon only has to reach its listen().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore — plain ESM hook modules
import { embedTexts, notifyEmbedder } from '../hooks/embed-client.mjs';
// @ts-ignore
import { PROTOCOL, socketPath } from '../hooks/embed-recipe.mjs';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zeros = Buffer.from(new Float32Array(768).buffer).toString('base64');
let base: string, home: string;
const saved = { ...process.env };

/** A fake daemon speaking `protocol` (undefined = a protocol-1 daemon: the field only on ping). */
async function fakeDaemon(protocol: number | undefined) {
  const ops: string[] = [], conns: Socket[] = [];
  const srv: Server = createServer((c) => {
    conns.push(c);
    let buf = '';
    c.on('data', (d) => {
      buf += d; const nl = buf.indexOf('\n'); if (nl < 0) return;
      const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); ops.push(msg.op);
      const extra = protocol === undefined ? {} : { protocol };
      const reply = msg.op === 'ping' ? { ok: true, protocol: protocol ?? 1, pid: process.pid, model: 'ready' }
        : msg.op === 'embed' ? { ok: true, vecs: msg.texts.map(() => zeros), ...extra }
        : { ok: true, ...extra };
      c.write(JSON.stringify(reply) + '\n');
      if (msg.op === 'stop') setTimeout(() => { conns.forEach((x) => x.destroy()); srv.close(); }, 20);
    });
    c.on('error', () => {});
  });
  await new Promise<void>((r) => srv.listen(socketPath(), r));
  return { ops, close: async () => { conns.forEach((x) => x.destroy()); await new Promise((r) => srv.close(() => r(null))); } };
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'eu-')); home = join(base, 'h'); // short: socket path < ~100 bytes
  mkdirSync(join(home, 'embedder'), { recursive: true });
  Object.assign(process.env, { COLDSTART_HOME: home, COLDSTART_MODEL_DIR: join(base, 'm'), COLDSTART_EMBEDDER: '1',
    COLDSTART_MODEL_URL: 'http://127.0.0.1:9/' }); // the spawned daemon's model download fails fast — never the network
});
afterAll(async () => {
  // the daemon we spawned: it fails to get a model and exits on its own; make sure
  try { const pid = JSON.parse(readFileSync(join(home, 'embedder', 'daemon.json'), 'utf8')).pid; process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  process.env = { ...saved };
  rmSync(base, { recursive: true, force: true });
});

describe('embed client replaces an older daemon that still answers', () => {
  // order matters: the replacement fires once per process, so the no-replace cases run first
  for (const p of [PROTOCOL, PROTOCOL + 1]) {
    it(`a protocol-${p} daemon (same or newer) is never replaced`, async () => {
      const f = await fakeDaemon(p);
      try {
        expect((await embedTexts(['q'], 'code_query'))?.length).toBe(1);
        await notifyEmbedder('notes-changed', base, join(base, 'cache'), {}, { optIn: false });
        await wait(1500);
        expect(f.ops).not.toContain('stop');
        expect(existsSync(join(home, 'embedder', 'spawn.lock'))).toBe(false); // nothing was spawned
      } finally { await f.close(); }
    });
  }

  it('a protocol-1 daemon answering an embed: the answer is used AND a new daemon takes over its socket', async () => {
    const f = await fakeDaemon(undefined);
    const vecs = await embedTexts(['q'], 'code_query');
    expect(vecs?.[0]?.length).toBe(768); // the old daemon's answer still serves this prompt
    for (let i = 0; i < 100 && !f.ops.includes('stop'); i++) await wait(100);
    expect(f.ops).toContain('stop'); // the spawned daemon's listen() pinged the old one and asked it to go
  }, 20_000);
});
