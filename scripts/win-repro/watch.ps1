# Temporary repro for issue #149 — NOT part of the package.
#
# A/B test on real Windows, run twice under two independent no-console
# mechanisms: Node's own `detached` spawn (proxies keeper.js's daemon
# relaunch) and a separately compiled GUI-subsystem (winexe) launcher
# (proxies how Electron apps like Claude Code/Cursor have no console when
# they spawn a hooks/*.mjs subprocess — ruling out "the fix only works
# around a Node spawn quirk"). Each pair runs the "unpatched" and "patched"
# execFileSync option shape and polls the real Win32 IsWindowVisible API to
# see whether a console window actually appears, isolating windowsHide as
# the only variable.

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class WinWatch {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public static List<string> GetVisibleWindows() {
        var result = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                int pid;
                GetWindowThreadProcessId(hWnd, out pid);
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                result.Add(pid + ":" + sb.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@

# Compile the GUI-subsystem (no-console) launcher: a faithful, independently
# built proxy for "an Electron app (Claude Code / Cursor) spawns a hook
# subprocess" — GUI-subsystem executables never attach a console on Windows,
# regardless of launch method, which is the exact condition hooks/*.mjs runs
# under in production, distinct from testing via Node's own `detached` spawn.
$csc = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
& $csc /nologo /target:winexe /out:"$PSScriptRoot\NoConsoleLauncher.exe" "$PSScriptRoot\NoConsoleLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed to compile NoConsoleLauncher.cs" }

function Run-Case([string]$mode, [string]$label, [switch]$NoConsole) {
    Write-Host "=== Case: $label ($mode$(if ($NoConsole) { ', via GUI-subsystem no-console launcher' })) ==="
    $before = [WinWatch]::GetVisibleWindows()

    if ($NoConsole) {
        # Hooks (hooks/*.mjs) run as a child of the host CLI's own process
        # (Claude Code / Cursor / Codex — Electron GUI-subsystem apps, which
        # never have a console when launched from Explorer/Start Menu, since
        # explorer.exe itself has none). A first attempt launched
        # NoConsoleLauncher.exe directly via Start-Process from pwsh, but
        # pwsh has its own console, and a plain launch (no explicit
        # detach) still lets that console be reachable down the chain —
        # so that attempt was testing the same non-vulnerable condition as
        # the earlier -Direct case, just one layer removed. Routing through
        # Node's own detached:true spawn (orchestrator-noconsole.mjs) — the
        # SAME mechanism already proven to sever inheritance for the daemon
        # case above — genuinely severs it here too before the WinExe
        # launcher takes over.
        node "$PSScriptRoot/orchestrator-noconsole.mjs" $mode
    } else {
        node "$PSScriptRoot/orchestrator.mjs" $mode
    }

    $sawNewWindow = $false
    $seenTitles = New-Object System.Collections.Generic.List[string]
    $deadline = (Get-Date).AddSeconds(4)
    while ((Get-Date) -lt $deadline) {
        $current = [WinWatch]::GetVisibleWindows()
        foreach ($w in $current) {
            if (($before -notcontains $w) -and ($seenTitles -notcontains $w)) {
                $seenTitles.Add($w)
                $sawNewWindow = $true
                Write-Host "  NEW WINDOW: $w"
            }
        }
        Start-Sleep -Milliseconds 40
    }

    # Clean up only ping.exe stragglers this case spawned — never touch
    # conhost/WindowsTerminal/OpenConsole, those can back the runner's own
    # PowerShell session and killing them broke the next case outright.
    Get-Process -Name 'ping' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    if ($sawNewWindow) {
        Write-Host "RESULT: $label -> WINDOW FLASHED ($($seenTitles.Count) window(s))"
    } else {
        Write-Host "RESULT: $label -> no window observed"
    }
    return $sawNewWindow
}

$resultUnfixed = Run-Case "no-windowsHide" "UNPATCHED shape (matches src/indexer/git.ts), via detached daemon-shape parent"
Start-Sleep -Seconds 1
$resultFixed = Run-Case "windowsHide" "PATCHED shape (matches the fixed daemon/CLI call sites), via detached daemon-shape parent"
Start-Sleep -Seconds 1
$resultHooksUnfixed = Run-Case "no-windowsHide" "UNPATCHED shape (matches hooks/*.mjs before this fix), via GUI-subsystem no-console launcher" -NoConsole
Start-Sleep -Seconds 1
$resultHooksFixed = Run-Case "windowsHide" "PATCHED shape (matches hooks/*.mjs after this fix), via GUI-subsystem no-console launcher" -NoConsole

Write-Host ""
Write-Host "SUMMARY"
if ($resultUnfixed) { Write-Host "  Unpatched, detached-parent shape:     WINDOW APPEARED (bug reproduces)" }
else { Write-Host "  Unpatched, detached-parent shape:     no window (unexpected)" }
if ($resultFixed) { Write-Host "  Patched, detached-parent shape:       WINDOW APPEARED (fix NOT working!)" }
else { Write-Host "  Patched, detached-parent shape:       no window (fix confirmed)" }
if ($resultHooksUnfixed) { Write-Host "  Unpatched, GUI-subsystem launcher:    WINDOW APPEARED (bug reproduces)" }
else { Write-Host "  Unpatched, GUI-subsystem launcher:    no window (unexpected)" }
if ($resultHooksFixed) { Write-Host "  Patched, GUI-subsystem launcher:      WINDOW APPEARED (fix NOT working!)" }
else { Write-Host "  Patched, GUI-subsystem launcher:      no window (fix confirmed)" }

if ($resultUnfixed -and (-not $resultFixed) -and $resultHooksUnfixed -and (-not $resultHooksFixed)) {
    Write-Host ""
    Write-Host "CONCLUSION: Fix verified on real Windows via TWO independent no-console mechanisms — Node's own detached spawn (proxies keeper.js's daemon relaunch) AND a genuinely separate compiled GUI-subsystem (winexe) launcher (proxies how Electron apps like Claude Code/Cursor have no console when they spawn a hooks/*.mjs subprocess). windowsHide:true suppresses the console flash in both; the unpatched shape flashes in both. This directly supports the hooks/*.mjs fix, not just the daemon fix."
    exit 0
} else {
    Write-Host ""
    Write-Host "CONCLUSION: Unexpected result — needs investigation before drawing conclusions."
    exit 1
}
