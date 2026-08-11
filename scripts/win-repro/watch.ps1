# Temporary repro for issue #149 — NOT part of the package.
#
# A/B test on real Windows, run twice under two independent no-console
# mechanisms: Node's own `detached` spawn (proxies keeper.js's daemon
# relaunch) and a Win32 DETACHED_PROCESS launcher (proxies how Electron apps
# like Claude Code/Cursor have no console when they spawn a hooks/*.mjs
# subprocess — ruling out "the fix only works around a Node spawn quirk").
# Each pair runs the "unpatched" and "patched" execFileSync option shape and
# polls the real Win32 IsWindowVisible API to see whether a console window
# actually appears, isolating windowsHide as the only variable.
#
# Run this with `pwsh` (PowerShell 7+), not Windows PowerShell 5.1 — this
# file is UTF-8 without a BOM (it has em-dashes above), and powershell.exe
# reads no-BOM files using the system codepage, which mangles those bytes
# into stray characters and breaks parsing further down the file.
#
# NOTE on an earlier attempt (see git history on this branch): a first cut
# of the hooks-shape case used a GUI-subsystem (winexe) launcher that struck
# .NET's ProcessStartInfo.CreateNoWindow on the intermediate node.exe process
# before it ran the harness. That produced NO flash in EITHER branch — an
# inconclusive A/B, since a bug can't be shown fixed if the unpatched
# baseline never reproduces it. Root cause (confirmed by direct comparison
# on real Windows 11 hardware): CreateNoWindow leaves that process with a
# hidden-but-still-attached console object, not zero console, so its own
# child (ping.exe) just reused the hidden console instead of requesting a
# new (visible) one — regardless of windowsHide. DetachedLauncher.cs below
# uses the real Win32 DETACHED_PROCESS flag via raw CreateProcess instead,
# which gives the child genuinely no console object at all — the actual
# condition hooks/*.mjs runs under — and DOES show the expected flash/no-
# flash split.

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

# Compile the DETACHED_PROCESS launcher: a faithful proxy for "an Electron
# app (Claude Code / Cursor) spawns a hook subprocess" — see the file header
# comment in DetachedLauncher.cs for why this replaced an earlier, flawed
# CreateNoWindow-based approach.
$csc = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
& $csc /nologo /target:winexe /out:"$PSScriptRoot\DetachedLauncher.exe" "$PSScriptRoot\DetachedLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed to compile DetachedLauncher.cs" }

function Run-Case([string]$mode, [string]$label, [switch]$NoConsole) {
    Write-Host "=== Case: $label ($mode$(if ($NoConsole) { ', via DETACHED_PROCESS launcher' })) ==="
    $before = [WinWatch]::GetVisibleWindows()

    if ($NoConsole) {
        & "$PSScriptRoot\DetachedLauncher.exe" "$PSScriptRoot\harness.mjs" $mode
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
$resultHooksUnfixed = Run-Case "no-windowsHide" "UNPATCHED shape (matches hooks/*.mjs before this fix), via DETACHED_PROCESS launcher" -NoConsole
Start-Sleep -Seconds 1
$resultHooksFixed = Run-Case "windowsHide" "PATCHED shape (matches hooks/*.mjs after this fix), via DETACHED_PROCESS launcher" -NoConsole

Write-Host ""
Write-Host "SUMMARY"
if ($resultUnfixed) { Write-Host "  Unpatched, detached-parent shape:     WINDOW APPEARED (bug reproduces)" }
else { Write-Host "  Unpatched, detached-parent shape:     no window (unexpected)" }
if ($resultFixed) { Write-Host "  Patched, detached-parent shape:       WINDOW APPEARED (fix NOT working!)" }
else { Write-Host "  Patched, detached-parent shape:       no window (fix confirmed)" }
if ($resultHooksUnfixed) { Write-Host "  Unpatched, DETACHED_PROCESS launcher: WINDOW APPEARED (bug reproduces)" }
else { Write-Host "  Unpatched, DETACHED_PROCESS launcher: no window (unexpected)" }
if ($resultHooksFixed) { Write-Host "  Patched, DETACHED_PROCESS launcher:   WINDOW APPEARED (fix NOT working!)" }
else { Write-Host "  Patched, DETACHED_PROCESS launcher:   no window (fix confirmed)" }

if ($resultUnfixed -and (-not $resultFixed) -and $resultHooksUnfixed -and (-not $resultHooksFixed)) {
    Write-Host ""
    Write-Host "CONCLUSION: Fix verified on real Windows via TWO independent no-console mechanisms - Node's own detached spawn (proxies keeper.js's daemon relaunch) AND a genuine Win32 DETACHED_PROCESS launcher (proxies how Electron apps like Claude Code/Cursor have no console when they spawn a hooks/*.mjs subprocess). windowsHide:true suppresses the console flash in both; the unpatched shape flashes in both. This directly supports the hooks/*.mjs fix, not just the daemon fix."
    exit 0
} else {
    Write-Host ""
    Write-Host "CONCLUSION: Unexpected result - needs investigation before drawing conclusions."
    exit 1
}
