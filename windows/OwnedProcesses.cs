using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// A process-lifetime job: Windows closes this non-inheritable handle when the
// desktop process exits or crashes, terminating only its own descendants.
internal static class OwnedProcesses {
    private static IntPtr job;
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcess, PerJob;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
        public int Size; public string Reserved, Desktop, Title;
        public int X,Y,XSize,YSize,XCount,YCount,Fill,Flags;
        public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string exe, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo info);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] internal static extern IntPtr LoadLibrary(string name);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr handle, int command);
    internal static void BindLifetime() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new Limits();
        limits.Basic.Flags = 0x2000 | 0x0800; // KILL_ON_JOB_CLOSE; explicit BREAKAWAY_OK for the verified updater only.
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits))) ||
            !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) throw new Win32Exception();
        // Do not close this handle explicitly: the owner belongs to the job too.
    }
    internal static void StartUpdateHelper(string exe, string command, string cwd) {
        var startup = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfo)) };
        ProcessInfo info;
        if (!CreateProcess(exe, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false,
            0x01000000 | 0x08000000, IntPtr.Zero, cwd, ref startup, out info)) throw new Win32Exception();
        CloseHandle(info.Thread); CloseHandle(info.Process);
    }
}
