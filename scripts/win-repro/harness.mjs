// Temporary repro for issue #149 — NOT part of the package.
//
// Reproduces the exact execFileSync option shapes used across the codebase,
// with `git`/`rg` swapped for `ping` purely to give a visibility poll enough
// runtime to observe a console window (per the issue reporter's own repro —
// this doesn't change whether Windows allocates a window, only how long it
// stays open to see). Invoked with one of:
//
//   no-windowsHide  — matches src/indexer/git.ts (the unpatched gap)
//   windowsHide     — matches the 7 sites already patched for #149
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
const baseOpts = { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 };
const opts = mode === 'windowsHide' ? { ...baseOpts, windowsHide: true } : baseOpts;

execFileSync('ping', ['-n', '3', '127.0.0.1'], opts);
