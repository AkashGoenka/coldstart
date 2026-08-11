# Temporary repro for issue #149 — NOT part of the package.
#
# A/B test on real Windows: runs the "unpatched" option shape (matches
# src/indexer/git.ts, which issue #149's fix missed) and the "patched" shape
# (matches the 7 sites already fixed) through the identical detached-parent
# spawn keeper.js uses, and polls the real Win32 IsWindowVisible API to see
# whether a console window actually appears. Isolates the flag as the only
# variable.

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

function Run-Case([string]$mode, [string]$label) {
    Write-Host "=== Case: $label ($mode) ==="
    $before = [WinWatch]::GetVisibleWindows()

    node "$PSScriptRoot/orchestrator.mjs" $mode

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

$resultUnfixed = Run-Case "no-windowsHide" "UNPATCHED shape (matches src/indexer/git.ts)"
Start-Sleep -Seconds 1
$resultFixed = Run-Case "windowsHide" "PATCHED shape (matches the 7 fixed call sites)"

Write-Host ""
Write-Host "SUMMARY"
if ($resultUnfixed) { Write-Host "  Unpatched shape (no windowsHide): WINDOW APPEARED (bug reproduces)" }
else { Write-Host "  Unpatched shape (no windowsHide): no window (unexpected)" }
if ($resultFixed) { Write-Host "  Patched shape (windowsHide:true):  WINDOW APPEARED (fix NOT working!)" }
else { Write-Host "  Patched shape (windowsHide:true):  no window (fix confirmed)" }

if ($resultUnfixed -and (-not $resultFixed)) {
    Write-Host ""
    Write-Host "CONCLUSION: Fix verified on real Windows. windowsHide:true suppresses the console flash for the patched shape; src/indexer/git.ts uses the vulnerable (unpatched) shape and would exhibit the same bug if left unfixed."
    exit 0
} else {
    Write-Host ""
    Write-Host "CONCLUSION: Unexpected result — needs investigation before drawing conclusions."
    exit 1
}
