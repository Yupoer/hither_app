param(
  [ValidateRange(1, 1800)][int]$Seconds = 300,
  [ValidateRange(1, 100)][int]$CpuCorePercent = 25,
  [ValidateRange(32, 256)][int]$JsOldSpaceMb = 64,
  [ValidateRange(128, 1024)][int]$ProcessCommitMb = 256
)
$ErrorActionPreference = 'Stop'
# Windows constraints on the Node harness only; this is not an A14/GPU emulator.
if (-not ('HitherPressureJob' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HitherPressureJob {
  [StructLayout(LayoutKind.Sequential)] struct Cpu { public uint Flags, Rate; }
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic; public Io Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true, EntryPoint="SetInformationJobObject")]
  static extern bool SetCpu(IntPtr job, int info, ref Cpu value, uint size);
  [DllImport("kernel32.dll", SetLastError=true, EntryPoint="SetInformationJobObject")]
  static extern bool SetLimits(IntPtr job, int info, ref Extended value, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern uint GetActiveProcessorCount(ushort group);
  public static void Configure(IntPtr job, uint rate, ulong affinity, ulong memory) {
    var cpu = new Cpu { Flags = 5, Rate = rate }; // ENABLE | HARD_CAP
    if (!SetCpu(job, 15, ref cpu, (uint)Marshal.SizeOf(cpu))) throw new Win32Exception();
    // AFFINITY | PROCESS_MEMORY | KILL_ON_JOB_CLOSE: no orphan on runner exit.
    var limits = new Extended { Basic = new Basic { Flags = 0x2110, Affinity = (UIntPtr)affinity }, ProcessMemory = (UIntPtr)memory };
    if (!SetLimits(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
  }
}
'@
}
$taskAppRoot = Split-Path $PSScriptRoot -Parent
$taskArtifacts = Join-Path $taskAppRoot 'test-artifacts'
New-Item -ItemType Directory -Path $taskArtifacts -Force | Out-Null
$taskStamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$taskOutput = Join-Path $taskArtifacts "parent-281-ui-pressure-limited-$taskStamp.json"
$taskError = Join-Path $taskArtifacts "parent-281-ui-pressure-limited-$taskStamp.err"
$taskCpuCount = [HitherPressureJob]::GetActiveProcessorCount(0xffff)
if (-not $taskCpuCount) { throw 'Cannot determine CPU quota; no unconstrained fallback.' }
$taskCpuRate = [Math]::Max(1, [Math]::Floor($CpuCorePercent * 100 / $taskCpuCount))
$taskAvailable = [System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity.ToInt64()
$taskAffinity = $taskAvailable -band (-$taskAvailable)
if ($taskAffinity -le 0) { throw 'No supported single-core affinity; no unconstrained fallback.' }
$taskJob = [HitherPressureJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($taskJob -eq [IntPtr]::Zero) { throw [ComponentModel.Win32Exception]::new() }
$taskChild = $null
try {
  [HitherPressureJob]::Configure($taskJob, $taskCpuRate, $taskAffinity, $ProcessCommitMb * 1MB)
  $taskNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  $taskChild = Start-Process -FilePath $taskNode -ArgumentList @('--expose-gc', "--max-old-space-size=$JsOldSpaceMb", 'scripts/pressure-foreground-ui.cjs', $Seconds) -WorkingDirectory $taskAppRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $taskOutput -RedirectStandardError $taskError
  if (-not [HitherPressureJob]::AssignProcessToJobObject($taskJob, $taskChild.Handle)) { throw [ComponentModel.Win32Exception]::new() }
  if ($taskChild.ProcessorAffinity.ToInt64() -ne $taskAffinity) { throw 'Single-core affinity was not applied.' }
  Write-Output "Limited pressure started: one logical CPU, rate $taskCpuRate/10000 of system CPU, JS old space $JsOldSpaceMb MiB, process commit $ProcessCommitMb MiB."
  $taskChild.WaitForExit()
  if ($taskChild.ExitCode -ne 0) { throw "Pressure failed (exit $($taskChild.ExitCode)): $(Get-Content -LiteralPath $taskError -Raw)" }
  $taskResult = Get-Content -LiteralPath $taskOutput -Raw | ConvertFrom-Json
  $taskResult | Add-Member -NotePropertyName constraints -NotePropertyValue @{
    affinityMask = $taskAffinity; activeSystemProcessors = $taskCpuCount
    systemCpuRatePer10000 = $taskCpuRate; requestedSingleCorePercent = $CpuCorePercent
    jsOldSpaceLimitMiB = $JsOldSpaceMb; processCommitLimitMiB = $ProcessCommitMb
    nativeJobLimitsApplied = $true; hardwareEquivalent = $false
  }
  $taskResult | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskOutput -Encoding UTF8
  Write-Output "Results: $taskOutput"
  Get-Content -LiteralPath $taskOutput
} finally {
  # Only this newly created harness process is owned by this runner.
  if ($taskChild -and -not $taskChild.HasExited) { $taskChild.Kill(); $taskChild.WaitForExit() }
  [void][HitherPressureJob]::CloseHandle($taskJob)
  if ($taskChild) { $taskChild.Dispose() }
}
