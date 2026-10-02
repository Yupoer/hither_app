[CmdletBinding()]
param(
  [string]$ProjectName = 'hither-legal'
)

$ErrorActionPreference = 'Stop'
$contactEmail = [Environment]::GetEnvironmentVariable('BREVO_SENDER_EMAIL')
if ([string]::IsNullOrWhiteSpace($contactEmail)) {
  throw 'Set BREVO_SENDER_EMAIL in the local shell before deploying the legal site.'
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

$deployOutput = (& npx.cmd --yes wrangler@latest pages deploy $staging --project-name $ProjectName --branch master | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed; no successful deployment was claimed.' }
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
foreach ($path in @('/auth/callback', '/auth/recovery', '/auth/recovery/recovery.mjs')) {
  $remote = & $readRemote $path
  $localPath = if ($path.EndsWith('.mjs')) { $path } else { $path + '/index.html' }
  if ($remote.Trim() -cne [IO.File]::ReadAllText((Join-Path $staging $localPath.TrimStart('/')), $utf8).Trim()) {
    throw "Auth page readback mismatch: $path"
  }
}
Write-Output "DEPLOYMENT_URL=$deploymentUrl"
Write-Output "LEGAL_BASE_URL=$baseUrl"
Write-Output "EXPO_PUBLIC_PRIVACY_URL=$baseUrl/privacy/"
Write-Output "EXPO_PUBLIC_TERMS_URL=$baseUrl/terms/"
