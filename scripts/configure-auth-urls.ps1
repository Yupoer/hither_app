[CmdletBinding()]
param([string]$Origin = 'https://hither-legal.pages.dev', [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$uri = [uri]$Origin
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or
    $uri.Query -or $uri.Fragment -or $uri.UserInfo -or -not $uri.IsDefaultPort) {
  throw 'Supply a controlled HTTPS origin without a path.'
}
$Origin = $uri.GetLeftPart([UriPartial]::Authority)
if (-not $env:SUPABASE_ACCESS_TOKEN) { throw 'SUPABASE_ACCESS_TOKEN is required; its value is never printed.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Cloud URL changes are unsafe before both platform associations and the legacy
# recovery fallback are publicly available at the exact configured origin.
foreach ($path in @('/.well-known/apple-app-site-association', '/.well-known/assetlinks.json',
                    '/auth/callback/', '/auth/recovery/', '/auth/recovery/recovery.mjs')) {
  $response = Invoke-WebRequest -Uri ($Origin + $path) -MaximumRedirection 0
  if ($response.StatusCode -ne 200) { throw "HTTPS preflight failed: $path" }
  if ($path.Contains('/.well-known/') -and [string]$response.Headers['Content-Type'] -notmatch '^application/json(?:;|$)') {
    throw "Association response is not JSON: $path"
  }
  $localPath = if ($path.EndsWith('/')) { $path + 'index.html' } else { $path }
  $expected = [IO.File]::ReadAllText((Join-Path $repo ('apps/legal-site' + $localPath)))
  if ([string]$response.Content.Trim() -cne $expected.Trim()) { throw "HTTPS source readback mismatch: $path" }
}
$endpoint = 'https://api.supabase.com/v1/projects/htqrucnjafhhvxdqslbv/config/auth'
$headers = @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"; Accept = 'application/json' }
$before = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers
$allow = @([string]$before.uri_allow_list -split '[,\r\n]+' | ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and $_ -notmatch '^(?i:hither|exp):' })
$allow += ($Origin + '/auth/callback?state=*'), ($Origin + '/auth/recovery?state=*')
$patch = @{ site_url = $Origin + '/auth/callback'; uri_allow_list = (@($allow | Select-Object -Unique) -join ',') }
if ($DryRun) { $patch | ConvertTo-Json; Write-Output 'HTTPS preflight passed; no Auth configuration changed.'; exit 0 }
Invoke-RestMethod -Method Patch -Uri $endpoint -Headers $headers -ContentType 'application/json' -Body ($patch | ConvertTo-Json -Compress) | Out-Null
$after = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers
if ($after.site_url -ne $patch.site_url -or $after.uri_allow_list -ne $patch.uri_allow_list) { throw 'HTTPS Auth URL readback mismatch.' }
$changed = @($before.PSObject.Properties.Name | Where-Object {
  $_ -notin @('site_url', 'uri_allow_list') -and
  (($before.$_ | ConvertTo-Json -Depth 20 -Compress) -cne ($after.$_ | ConvertTo-Json -Depth 20 -Compress))
})
if ($changed.Count) { throw ('Unrelated Auth fields changed: ' + ($changed -join ',')) }
$after | Select-Object site_url, uri_allow_list | ConvertTo-Json
Write-Output 'HTTPS Auth redirects verified; every unrelated SMTP/OAuth/Auth field is unchanged.'
