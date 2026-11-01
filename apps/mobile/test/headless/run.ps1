[CmdletBinding(PositionalBinding = $false)]
param(
  [ValidateRange(0.01, 100)]
  [double]$CpuPercent = 4.5,
  [ValidateSet('suite', 'trip', 'jest')]
  [string]$Driver = 'suite',
  [string]$ResourceReport,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$DriverArguments = @()
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$logicalProcessors = [Environment]::ProcessorCount
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$driverPath = switch ($Driver) {
  'suite' { Join-Path $PSScriptRoot 'run.cjs' }
  'trip' { Join-Path $PSScriptRoot 'tokyo-trip.cjs' }
  'jest' { Join-Path $mobileRoot 'node_modules/jest/bin/jest.js' }
}
$reportPath = if ($ResourceReport) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ResourceReport) }
$originalCompileCache = [Environment]::GetEnvironmentVariable('NODE_COMPILE_CACHE', 'Process')
$originalDisableCache = [Environment]::GetEnvironmentVariable('NODE_DISABLE_COMPILE_CACHE', 'Process')
$failures = [Collections.Generic.List[string]]::new()
$job = $null
$clock = $null
$cpuBefore = $null
$cpuSeconds = $null
$nativeExitCode = $null
$locationChanged = $false

try {
  . (Join-Path $PSScriptRoot 'cpu-budget.ps1')
  $job = [HitherHeadlessCpuBudget]::new()
  $job.Set($CpuPercent)
  if ($null -ne [Environment]::GetEnvironmentVariable('NODE_V8_COVERAGE', 'Process')) {
    [Environment]::SetEnvironmentVariable('NODE_DISABLE_COMPILE_CACHE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('NODE_COMPILE_CACHE', $null, 'Process')
  } else {
    [Environment]::SetEnvironmentVariable('NODE_COMPILE_CACHE', (Join-Path $mobileRoot 'node_modules/.cache/hither-headless/v8'), 'Process')
  }
  Push-Location -LiteralPath $mobileRoot
  $locationChanged = $true
  $cpuBefore = $job.CpuSeconds()
  $clock = [Diagnostics.Stopwatch]::StartNew()
  & node $driverPath @DriverArguments
  $nativeExitCode = $LASTEXITCODE
} catch {
  $failures.Add($_.Exception.Message)
} finally {
  if ($clock) { $clock.Stop() }
  if ($job) {
    try {
      if ($null -ne $cpuBefore) { $cpuSeconds = $job.CpuSeconds() - $cpuBefore }
    } catch { $failures.Add($_.Exception.Message) }
    try { $job.Dispose() } catch { $failures.Add($_.Exception.Message) }
  }
  try {
    [Environment]::SetEnvironmentVariable('NODE_COMPILE_CACHE', $originalCompileCache, 'Process')
  } catch { $failures.Add($_.Exception.Message) }
  try {
    [Environment]::SetEnvironmentVariable('NODE_DISABLE_COMPILE_CACHE', $originalDisableCache, 'Process')
  } catch { $failures.Add($_.Exception.Message) }
  if ($locationChanged) {
    try { Pop-Location } catch { $failures.Add($_.Exception.Message) }
  }
}

$launcherExitCode = if ($null -ne $nativeExitCode -and $nativeExitCode -ne 0) { $nativeExitCode }
  elseif ($failures.Count -or $null -eq $nativeExitCode) { 1 } else { 0 }
if ($reportPath) {
  try {
    $wallSeconds = if ($clock) { $clock.Elapsed.TotalSeconds } else { $null }
    $hostCpuPercent = if ($null -ne $cpuSeconds -and $wallSeconds -gt 0) {
      100 * $cpuSeconds / ($wallSeconds * $logicalProcessors)
    } else { $null }
    $report = [ordered]@{
      driver = $Driver
      cpuPercent = [Math]::Round($CpuPercent * 100) / 100
      logicalProcessors = $logicalProcessors
      jobCpuSeconds = $cpuSeconds
      wallSeconds = $wallSeconds
      testHostCpuPercent = $hostCpuPercent
      nativeExitCode = $nativeExitCode
      exitCode = $launcherExitCode
      errors = $failures.ToArray()
    }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reportPath)) | Out-Null
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  } catch {
    $failures.Add("Resource report failed: $($_.Exception.Message)")
    if ($launcherExitCode -eq 0) { $launcherExitCode = 1 }
  }
}
foreach ($failure in $failures) { [Console]::Error.WriteLine("[headless] $failure") }
exit $launcherExitCode
