// Temporary repro for issue #149 — NOT part of the package.
//
// Node's own detached:true spawn already proved it severs console
// inheritance (the daemon-shape case flashes without the fix). This uses
// THAT proven mechanism to launch NoConsoleLauncher.exe itself detached, so
// the WinExe launcher genuinely has nothing to inherit from — instead of
// PowerShell's Start-Process launching it directly, which (as the previous
// attempt showed) still leaves pwsh's own console reachable in the chain.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const dir = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(dir, 'NoConsoleLauncher.exe');
const harness = path.join(dir, 'harness.mjs');

const child = spawn(launcher, [harness, mode], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
