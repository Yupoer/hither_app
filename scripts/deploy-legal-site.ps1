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
Get-ChildItem -LiteralPath $staging -Recurse -File | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Raw
  Set-Content -LiteralPath $_.FullName -Value ($content.Replace('__CONTACT_EMAIL__', $contactEmail)) -Encoding utf8 -NoNewline
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
foreach ($path in @('/privacy/', '/terms/', '/styles.css')) {
  $status = (& curl.exe --fail --silent --show-error --output NUL --write-out '%{http_code}' ($baseUrl + $path) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $status -ne '200') { throw "Legal URL check failed: $path ($status)" }
}
Write-Output "LEGAL_BASE_URL=$baseUrl"
Write-Output "EXPO_PUBLIC_PRIVACY_URL=$baseUrl/privacy/"
Write-Output "EXPO_PUBLIC_TERMS_URL=$baseUrl/terms/"
