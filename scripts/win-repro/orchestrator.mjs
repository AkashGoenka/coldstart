// Temporary repro for issue #149 — NOT part of the package.
//
// Mirrors keeper.js's own self-relaunch shape exactly: detached, stdio
// ignored, no console of its own — the condition under which the daemon
// runs when it makes its git/ripgrep calls.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const dir = path.dirname(fileURLToPath(import.meta.url));
const harness = path.join(dir, 'harness.mjs');

const child = spawn(process.execPath, [harness, mode], { detached: true, stdio: 'ignore' });
child.unref();
