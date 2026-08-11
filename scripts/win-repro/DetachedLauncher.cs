// Temporary repro for issue #149 — NOT part of the package.
//
// Replaces an earlier attempt that used .NET's ProcessStartInfo.CreateNoWindow
// on an intermediate node.exe process to strip its console before it spawned
// the harness. That produced NO flash in either the patched or unpatched
// branch — an inconclusive A/B, since a bug can't be shown fixed if the
// baseline never reproduces it. Root cause: CreateNoWindow leaves the child
// with a hidden-but-still-attached console object, not zero console — so
// grandchildren (ping.exe, spawned by harness.mjs) just reused that hidden
// console instead of requesting a new (visible) one, regardless of
// windowsHide.
//
// This launcher instead calls Win32 CreateProcess directly with
// DETACHED_PROCESS (0x00000008) — genuinely no console object at all for the
// child, not merely a hidden one. That's the real condition an Electron
// app's (Claude Code / Cursor) node-hook child process runs under when the
// Electron app itself has no console (typical GUI launch), making it a
// faithful proxy for hooks/*.mjs's actual runtime shape. Verified on real
// Windows 11 hardware (not just CI) with direct human visual confirmation
// alongside the automated IsWindowVisible poll: unpatched flashes a new
// console window (ping.exe + its host), patched shows nothing.
using System;
using System.Runtime.InteropServices;
using System.Text;

class DetachedLauncher {
    const uint DETACHED_PROCESS = 0x00000008;

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public int dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern bool CreateProcess(
        string lpApplicationName, StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    static void Main(string[] args) {
        // args: <harness.mjs path> <mode>
        var quoted = Array.ConvertAll(args, a => a.Contains(" ") ? "\"" + a + "\"" : a);
        var cmdLine = new StringBuilder("node " + string.Join(" ", quoted));

        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION pi;

        bool ok = CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false,
            DETACHED_PROCESS, IntPtr.Zero, null, ref si, out pi);

        if (!ok) {
            Console.Error.WriteLine("CreateProcess failed: " + Marshal.GetLastWin32Error());
        }
    }
}
