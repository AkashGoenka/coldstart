/**
 * coldstart embed status | stop — the embedder daemon (docs/embedder-daemon-design.md §6).
 * status: daemon pid / memory / model / idle exit + per-repo % done. Falls back to the last state.json the
 * daemon wrote when it isn't running. stop: a socket message (Windows has no graceful SIGTERM).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request, embedderDisabled } from '../hooks/embed-client.mjs';
import { embedderHome } from '../hooks/embed-recipe.mjs';

const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`; };

export function formatStatus(st: any, live: boolean): string {
  const lines: string[] = [];
  if (live) {
    const m = st.model ?? {};
    const model = m.status === 'downloading' && m.total ? `downloading ${mb(m.have ?? 0)} / ${mb(m.total)}` : m.status;
    const idle = st.idleExitAt ? (st.idleExitAt > Date.now() ? `idle exit in ${ago(2 * Date.now() - st.idleExitAt)}` : 'idle exit due') : '';
    lines.push(`embedder: running · pid ${st.pid} · ${st.rssMB} MB · model ${model}${st.selfBenchMs != null ? ` · query ${st.selfBenchMs} ms` : ''} · ${st.threads} thread(s)${idle ? ` · ${idle}` : ''}`);
  } else {
    lines.push(`embedder: not running${st ? ` (last seen ${ago(st.lastActivityAt ?? st.startedAt)} ago)` : ''} — starts on the next index save or prompt`);
  }
  for (const [root, r] of Object.entries<any>(st?.repos ?? {})) {
    const pct = r.total ? Math.floor((100 * r.done) / r.total) : 0;
    lines.push(`  ${root}  ${r.status}  ${r.done}/${r.total} (${pct}%)${r.queued ? ` · ${r.queued} queued` : ''}`);
  }
  if (st?.failures) lines.push(`  ${st.failures} embed failure(s) — see ${join(embedderHome(), 'embedder.log')}`);
  return lines.join('\n');
}

export async function runEmbed(args: string[]): Promise<number> {
  const sub = args[0] ?? 'status';
  if (embedderDisabled()) { process.stdout.write('embedder: off — opt-in for now: `coldstart init --embedder` or COLDSTART_EMBEDDER=1\n'); return 0; }
  if (sub === 'status') {
    const live = await request({ op: 'status' }, { connectMs: 300, budgetMs: 1000 });
    let st = live;
    if (!st) { try { st = JSON.parse(readFileSync(join(embedderHome(), 'state.json'), 'utf8')); } catch { st = null; } }
    process.stdout.write(formatStatus(st, !!live) + '\n');
    return 0;
  }
  if (sub === 'stop') {
    const r = await request({ op: 'stop' }, { connectMs: 300, budgetMs: 2000 });
    process.stdout.write(r?.ok ? 'embedder: stopped\n' : 'embedder: not running\n');
    return 0;
  }
  process.stderr.write('usage: coldstart embed status|stop\n');
  return 2;
}
