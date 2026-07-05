// bench-find.mjs — coldstart `find` baseline for one machine.
// Usage: node bench-find.mjs /path/to/coldstart-repo /path/to/JMRI
// Prints one self-contained report. Run it, paste the whole output back.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';

const [, , csRoot, repo] = process.argv;
if (!csRoot || !repo) {
  console.error('usage: node bench-find.mjs <coldstart-repo> <target-repo>');
  process.exit(1);
}
const cli = join(csRoot, 'dist', 'index.js');
if (!existsSync(cli)) {
  console.error(`dist/index.js not found under ${csRoot} — run \`npm run build\` there first`);
  process.exit(1);
}

// Fixed query set (JMRI-flavored). Timing needs realistic multi-term queries;
// whether each query "finds the right file" is irrelevant here.
const QUERIES = [
  'turnout state listener',
  'signal head appearance logic',
  'throttle speed step change',
  'decoder CV programming write',
  'LocoNet message opcode parse',
  'sensor debounce timer delay',
];
const WARM_RUNS = 3;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function run(cmd, args, cwd) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, timeout: 900000 });
  return { ms: Date.now() - t0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// Which searcher will find's recall pass use on THIS machine? Mirrors find.ts:
// persisted rg (~/.coldstart/searcher.json) → bundled @vscode/ripgrep → PATH rg
// → git grep → grep. Scan args match find's exactly (-j2 per scan).
function detectSearcher() {
  const ok = (cmd, args) => spawnSync(cmd, args, { cwd: repo, stdio: 'ignore', timeout: 4000 }).status === 0;
  try {
    const cached = JSON.parse(readFileSync(join(os.homedir(), '.coldstart', 'searcher.json'), 'utf8'));
    if (cached.bin && !cached.argv0 && ok(cached.bin, ['--version'])) return { kind: 'rg', bin: cached.bin };
  } catch { /* no persisted searcher yet */ }
  try {
    const { rgPath } = createRequire(join(csRoot, 'package.json'))('@vscode/ripgrep');
    if (existsSync(rgPath) && ok(rgPath, ['--version'])) return { kind: 'rg', bin: rgPath };
  } catch { /* dependency not installed */ }
  if (ok('rg', ['--version'])) return { kind: 'rg', bin: 'rg' };
  if (ok('git', ['rev-parse', '--is-inside-work-tree'])) return { kind: 'gitgrep' };
  return { kind: 'grep' };
}

function grepArgs(searcher, term) {
  if (searcher.kind === 'rg') return [searcher.bin, ['-l', '-i', '-F', '-j', '2', '--', term, '.']];
  if (searcher.kind === 'gitgrep') return ['git', ['-c', 'grep.threads=1', 'grep', '--untracked', '-l', '-i', '-F', '-e', term]];
  return ['grep', ['-r', '-l', '-i', '-F', '-I', '--', term, '.']];
}

console.log('# coldstart find baseline');
console.log(`machine: ${os.cpus()[0]?.model ?? '?'} x${os.cpus().length} · ${Math.round(os.totalmem() / 2 ** 30)}GB · ${os.platform()} ${os.arch()} · node ${process.version}`);
const searcher = detectSearcher();
console.log(`recall searcher on this machine: ${searcher.kind}${searcher.bin ? ` (${searcher.bin})` : ''}`);

// --- 1. one-time index build --------------------------------------------
console.log('\n## 1. index build (coldstart index)');
const b = run('node', [cli, 'index', '--root', repo]);
const built = b.stderr.match(/indexed (\d+) files.*?in ([\d.]+)s/);
console.log(built ? `built ${built[1]} files in ${built[2]}s (wall ${(b.ms / 1000).toFixed(1)}s)` : `wall ${(b.ms / 1000).toFixed(1)}s (exit ${b.status})\n${b.stderr.slice(-400)}`);

// --- 2+3. find end-to-end (cold, then warm) + cache-load time ------------
console.log('\n## 2. find end-to-end (ms) — cold first, then median of warm runs');
console.log('query | cold | warm | cache-load(warm)');
const grepTotals = [];
let first = true;
for (const q of QUERIES) {
  const args = [cli, 'find', ...q.split(' '), '--root', repo];
  const cold = first ? run('node', args) : null;
  if (first) { sleep(20000); first = false; } // let the lazily-spawned keeper settle off the timed path
  const warm = [], loads = [];
  for (let i = 0; i < WARM_RUNS; i++) {
    const r = run('node', args);
    warm.push(r.ms);
    const m = r.stderr.match(/cache hit \((\d+)ms/);
    if (m) loads.push(Number(m[1]));
    if (r.status !== 0) console.log(`  !! exit ${r.status}: ${r.stderr.slice(-200)}`);
  }
  console.log(`${q} | ${cold ? cold.ms : '-'} | ${median(warm)} | ${loads.length ? median(loads) : '?'}`);
}

// --- 4. raw recall pass (same commands find spawns), per query ----------
console.log(`\n## 3. recall pass alone (${searcher}, ms per query = sum over terms)`);
console.log('query | grep-ms | files-matched(sum)');
for (const q of QUERIES) {
  let ms = 0, files = 0;
  for (const term of q.split(' ')) {
    const [bin, a] = grepArgs(searcher, term);
    const r = run(bin, a, repo);
    ms += r.ms;
    files += r.stdout ? r.stdout.trim().split('\n').filter(Boolean).length : 0;
  }
  grepTotals.push(ms);
  console.log(`${q} | ${ms} | ${files}`);
}

console.log('\n## summary');
console.log(`median recall pass: ${median(grepTotals)}ms — this is the trigram go/no-go number`);
console.log('done. paste this whole output back.');
