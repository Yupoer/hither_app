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
$staging = Join-Path (Join-Path $PSScriptRoot '..\.tmp') 'legal-site-deploy'
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $staging -Recurse -Force
$utf8 = New-Object System.Text.UTF8Encoding($false)
Get-ChildItem -LiteralPath $staging -Recurse -File -Filter '*.html' | ForEach-Object {
  # Windows PowerShell's default reader is not UTF-8. Decode and write HTML
  # explicitly so Chinese copy is never rewritten as ANSI/mojibake.
  $content = [System.IO.File]::ReadAllText($_.FullName, $utf8)
  [System.IO.File]::WriteAllText($_.FullName, $content.Replace('__CONTACT_EMAIL__', $contactEmail), $utf8)
}

$listJson = (& npx.cmd --yes wrangler@latest pages project list --json | Out-String)
$projects = @($listJson | ConvertFrom-Json)
$existing = $projects | Where-Object {
  $_.name -eq $ProjectName -or $_.project_name -eq $ProjectName -or $_.'Project Name' -eq $ProjectName
} | Select-Object -First 1
if (-not $existing) {
  $createdOutput = (& npx.cmd --yes wrangler@latest pages project create $ProjectName --production-branch master | Out-String)
  $createdName = [regex]::Match($createdOutput, '(?im)(?:project name|name)\s*[:=]\s*([A-Za-z0-9_-]+)').Groups[1].Value
  if ($createdName) { $ProjectName = $createdName }
}

$deployOutput = (& npx.cmd --yes wrangler@latest pages deploy $staging --project-name $ProjectName --branch master | Out-String)
$urlMatches = [regex]::Matches($deployOutput, 'https://[A-Za-z0-9.-]+\.pages\.dev')
if ($urlMatches.Count -eq 0) {
  throw 'Wrangler did not return the deployed pages.dev URL; no URL was guessed.'
}
$baseUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('/')
$readRemote = {
  param([string]$path)
  $temp = [System.IO.Path]::GetTempFileName()
  try {
    & curl.exe --fail --silent --show-error --location --output $temp ($baseUrl + $path)
    if ($LASTEXITCODE -ne 0) { throw "Legal URL check failed: $path" }
    return [System.IO.File]::ReadAllText($temp, $utf8)
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
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
Write-Output "LEGAL_BASE_URL=$baseUrl"
Write-Output "EXPO_PUBLIC_PRIVACY_URL=$baseUrl/privacy/"
Write-Output "EXPO_PUBLIC_TERMS_URL=$baseUrl/terms/"
