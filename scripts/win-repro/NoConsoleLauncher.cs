// Temporary repro for issue #149 — NOT part of the package.
//
// Compiled with /target:winexe (GUI subsystem), so this executable has NO
// console of its own — the same condition an Electron app's main process is
// in on Windows (GUI-subsystem executables never attach a console,
// regardless of launch method). This is a more faithful, independently-built
// proxy for "Claude Code / Cursor spawns a hook subprocess" than reusing
// orchestrator.mjs's Node `detached` spawn — it rules out the fix only
// working around a Node-specific spawn quirk rather than genuine Windows
// console-inheritance behavior.
using System.Diagnostics;

class NoConsoleLauncher {
    static void Main(string[] args) {
        var quoted = System.Array.ConvertAll(args, a => a.Contains(" ") ? "\"" + a + "\"" : a);
        var psi = new ProcessStartInfo("node", string.Join(" ", quoted)) {
            UseShellExecute = false,
            // Isolates the test to what coldstart's code controls: the INNER
            // execFileSync call inside harness.mjs. Without this, plain
            // `node` (a console-subsystem exe) would get its own
            // auto-allocated console just from being launched by a
            // console-less parent — a real effect, but it's Claude
            // Code/Cursor's own node-launch behavior, not this repo's code,
            // and would contaminate whether a flash came from that or from
            // the harness's own (fixed/unfixed) execFileSync call.
            CreateNoWindow = true,
        };
        // Fire-and-forget: don't block here, or the ~2s ping the harness
        // runs would already be finished (window closed) by the time the
        // caller starts polling for it.
        Process.Start(psi);
    }
}
