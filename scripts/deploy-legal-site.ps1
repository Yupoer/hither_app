[CmdletBinding()]
param(
  [string]$ProjectName = 'hither-legal',
  [Parameter(Mandatory = $true)]
  [string]$WranglerRoot,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$WranglerVersion,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9A-Fa-f]{64}$')]
  [string]$WranglerSha256
)

$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
if (-not [IO.Path]::IsPathRooted($WranglerRoot)) { throw 'WranglerRoot must be an absolute path.' }
$wranglerRootPath = (Resolve-Path -LiteralPath $WranglerRoot -ErrorAction Stop).Path
$wranglerPackagePath = Join-Path $wranglerRootPath 'node_modules\wrangler\package.json'
$wranglerEntrypoint = Join-Path $wranglerRootPath 'node_modules\wrangler\bin\wrangler.js'
if (-not (Test-Path -LiteralPath $wranglerPackagePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $wranglerEntrypoint -PathType Leaf)) {
  throw 'WranglerRoot must contain node_modules\wrangler with its package and direct CLI entrypoint.'
}
$installedWranglerVersion = (Get-Content -LiteralPath $wranglerPackagePath -Raw | ConvertFrom-Json).version
if ($installedWranglerVersion -cne $WranglerVersion) {
  throw "Wrangler version mismatch: expected $WranglerVersion, found $installedWranglerVersion."
}
$digestScript = (Join-Path $PSScriptRoot 'verified-cli-tree.mjs' | Resolve-Path).Path
$contactEmail = [Environment]::GetEnvironmentVariable('BREVO_SENDER_EMAIL')
if ([string]::IsNullOrWhiteSpace($contactEmail)) {
  throw 'Set BREVO_SENDER_EMAIL in the local shell before deploying the legal site.'
}
$cloudflareToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN')
$cloudflareAccountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID')
if ([string]::IsNullOrWhiteSpace($cloudflareToken) -or [string]::IsNullOrWhiteSpace($cloudflareAccountId)) {
  throw 'Set narrowly scoped CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID values before deploying.'
}

$source = (Join-Path $PSScriptRoot '..\apps\legal-site' | Resolve-Path).Path
$staging = Join-Path (Join-Path $PSScriptRoot '..\.tmp') ('legal-site-deploy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $staging -Recurse -Force
$utf8 = New-Object System.Text.UTF8Encoding($false)
Get-ChildItem -LiteralPath $staging -Recurse -File -Filter '*.html' | ForEach-Object {
  # Windows PowerShell's default reader is not UTF-8. Decode and write HTML
  # explicitly so Chinese copy is never rewritten as ANSI/mojibake.
  $content = [System.IO.File]::ReadAllText($_.FullName, $utf8)
  [System.IO.File]::WriteAllText($_.FullName, $content.Replace('__CONTACT_EMAIL__', $contactEmail), $utf8)
}

$savedEnvironment = @{}
Get-ChildItem Env: | ForEach-Object { $savedEnvironment[$_.Name] = $_.Value }
$allowedEnvironment = @(
  'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA',
  'PATHEXT'
)
try {
  Get-ChildItem Env: | Where-Object { $_.Name -notin $allowedEnvironment } |
    ForEach-Object { Remove-Item -LiteralPath ("Env:" + $_.Name) }
  $env:PATH = (Split-Path -Parent $nodePath) + ';' + (Join-Path $env:SYSTEMROOT 'System32')
  $actualWranglerSha256 = (& $nodePath $digestScript $wranglerRootPath | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualWranglerSha256 -cne $WranglerSha256.ToLowerInvariant()) {
    throw 'Wrangler installation does not match the reviewed SHA-256 tree digest.'
  }
  foreach ($name in @('NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY')) {
    if ($savedEnvironment.ContainsKey($name)) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
    }
  }
  $env:CLOUDFLARE_API_TOKEN = $cloudflareToken
  $env:CLOUDFLARE_ACCOUNT_ID = $cloudflareAccountId
  $deployOutput = (& $nodePath $wranglerEntrypoint pages deploy $staging --project-name $ProjectName --branch master | Out-String)
  $deployExitCode = $LASTEXITCODE
} finally {
  Get-ChildItem Env: | ForEach-Object { Remove-Item -LiteralPath ("Env:" + $_.Name) }
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name]) }
}
if ($deployExitCode -ne 0) { throw 'Cloudflare deployment failed; no successful deployment was claimed.' }
$urlMatches = [regex]::Matches($deployOutput, 'https://[A-Za-z0-9.-]+\.pages\.dev')
if ($urlMatches.Count -eq 0) {
  throw 'Wrangler did not return the deployed pages.dev URL; no URL was guessed.'
}
$deploymentUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('/')
$baseUrl = "https://$ProjectName.pages.dev"
$readRemote = {
  param([string]$path, [switch]$Json)
  $temp = [System.IO.Path]::GetTempFileName()
  $responseHeaders = [System.IO.Path]::GetTempFileName()
  try {
    & curl.exe --fail --silent --show-error --dump-header $responseHeaders --output $temp ($baseUrl + $path)
    if ($LASTEXITCODE -ne 0) { throw "Legal URL check failed: $path" }
    if ($Json -and [IO.File]::ReadAllText($responseHeaders) -notmatch '(?im)^Content-Type:\s*application/json(?:;|\s|$)') {
      throw "Association URL is not application/json: $path"
    }
    return [System.IO.File]::ReadAllText($temp, $utf8)
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $responseHeaders -Force -ErrorAction SilentlyContinue
  }
}
$privacyBody = & $readRemote '/privacy/'
$termsBody = & $readRemote '/terms/'
$stylesBody = & $readRemote '/styles.css'
if ($privacyBody.Length -lt 200 -or $privacyBody -notmatch '隱私權政策|Privacy Policy' -or $privacyBody -notmatch '中文' -or $privacyBody -notmatch 'English') {
  throw 'Privacy page content/encoding verification failed.'
}
if ($termsBody.Length -lt 200 -or $termsBody -notmatch '服務條款|Terms of Service' -or $termsBody -notmatch '中文' -or $termsBody -notmatch 'English') {
  throw 'Terms page content/encoding verification failed.'
}
if ($stylesBody.Length -lt 100 -or $stylesBody -notmatch 'body') {
  throw 'Legal stylesheet content verification failed.'
}
foreach ($path in @('/.well-known/apple-app-site-association', '/.well-known/assetlinks.json')) {
  $local = Join-Path $staging $path.TrimStart('/')
  if (-not (Test-Path -LiteralPath $local)) { throw "Missing association file: $path" }
  $remote = & $readRemote $path -Json
  $remote | ConvertFrom-Json | Out-Null
  if ($remote.Trim() -cne [IO.File]::ReadAllText($local, $utf8).Trim()) { throw "Association readback mismatch: $path" }
}
foreach ($path in @('/auth/callback/', '/auth/recovery/', '/auth/recovery/recovery.mjs')) {
  $remote = & $readRemote $path
  $localPath = if ($path.EndsWith('.mjs')) { $path } else { $path + 'index.html' }
  if ($remote.Trim() -cne [IO.File]::ReadAllText((Join-Path $staging $localPath.TrimStart('/')), $utf8).Trim()) {
    throw "Auth page readback mismatch: $path"
  }
}
Write-Output "DEPLOYMENT_URL=$deploymentUrl"
Write-Output "LEGAL_BASE_URL=$baseUrl"
Write-Output "EXPO_PUBLIC_PRIVACY_URL=$baseUrl/privacy/"
Write-Output "EXPO_PUBLIC_TERMS_URL=$baseUrl/terms/"
