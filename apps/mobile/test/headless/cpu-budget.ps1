if (-not ('HitherHeadlessCpuBudget' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class HitherHeadlessCpuBudget : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct CpuRate { public uint Flags, Rate; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long User, Kernel, PeriodUser, PeriodKernel;
    public uint PageFaults, Processes, ActiveProcesses, TerminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref CpuRate value, uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint size, out uint length);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  readonly IntPtr handle;
  public HitherHeadlessCpuBudget() {
    handle = CreateJobObject(IntPtr.Zero, null);
    if (handle == IntPtr.Zero) throw new Win32Exception();
    if (!AssignProcessToJobObject(handle, GetCurrentProcess())) {
      int error = Marshal.GetLastWin32Error(); CloseHandle(handle); throw new Win32Exception(error);
    }
  }
  public void Set(double percent) {
    CpuRate rate = new CpuRate { Flags = 5u, Rate = (uint)Math.Round(percent * 100) };
    if (!SetInformationJobObject(handle, 15, ref rate, (uint)Marshal.SizeOf<CpuRate>())) throw new Win32Exception();
  }
  public double CpuSeconds() {
    Accounting value; uint size;
    if (!QueryInformationJobObject(handle, 1, out value, (uint)Marshal.SizeOf<Accounting>(), out size)) throw new Win32Exception();
    return (value.User + value.Kernel) / 10000000.0;
  }
  public void Dispose() {
    // Closing a Job handle does not remove its live caller from the Job.
    try { Set(100); }
    finally {
      if (!CloseHandle(handle)) throw new Win32Exception();
    }
  }
}
'@
}
