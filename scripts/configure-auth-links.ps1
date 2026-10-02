[CmdletBinding()]
param([string]$Origin = $env:EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN,
      [string]$AndroidCertificateSha256 = $env:HITHER_ANDROID_CERTIFICATE_SHA256)
$ErrorActionPreference = 'Stop'
$uri = [uri]$Origin
if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or
    $uri.Query -or $uri.Fragment -or $uri.UserInfo -or -not $uri.IsDefaultPort) {
  throw 'Supply the controlled HTTPS EXPO_PUBLIC_AUTH_CALLBACK_ORIGIN without a path.'
}
if ($AndroidCertificateSha256 -notmatch '^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$') {
  throw 'HITHER_ANDROID_CERTIFICATE_SHA256 must be the production signing certificate SHA-256 fingerprint.'
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wellKnown = Join-Path $repo 'apps/legal-site/.well-known'
New-Item -ItemType Directory -Force -Path $wellKnown | Out-Null
$aasa = @{ applinks = @{ details = @(@{ appIDs = @('5LBPG5TUKP.app.hither.mobile');
  components = @(@{ '/' = '/auth/callback' }, @{ '/' = '/auth/recovery' }) }) } }
$assetlinks = @(@{ relation = @('delegate_permission/common.handle_all_urls');
  target = @{ namespace = 'android_app'; package_name = 'app.hither.mobile';
    sha256_cert_fingerprints = @($AndroidCertificateSha256.ToUpperInvariant()) } })
$utf8 = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $wellKnown 'apple-app-site-association'), ($aasa | ConvertTo-Json -Depth 10), $utf8)
[IO.File]::WriteAllText((Join-Path $wellKnown 'assetlinks.json'), (ConvertTo-Json -InputObject $assetlinks -Depth 10), $utf8)
# Existing iOS project is checked in: update only its associated-domains key.
$entitlements = Join-Path $repo 'apps/mobile/ios/Hither/Hither.entitlements'
[xml]$plist = [IO.File]::ReadAllText($entitlements)
$dict = $plist.plist.dict
$key = $dict.SelectSingleNode("key[text()='com.apple.developer.associated-domains']")
if ($key) { $array = $key.NextSibling; $dict.RemoveChild($array) | Out-Null; $dict.RemoveChild($key) | Out-Null }
$key = $plist.CreateElement('key'); $key.InnerText = 'com.apple.developer.associated-domains'; $dict.AppendChild($key) | Out-Null
$array = $plist.CreateElement('array'); $item = $plist.CreateElement('string'); $item.InnerText = 'applinks:' + $uri.Host
$array.AppendChild($item) | Out-Null; $dict.AppendChild($array) | Out-Null
$plist.Save($entitlements)
Write-Output 'Association files and native entitlement prepared. Deploy to the configured origin, verify both files, then build a compatible binary.'
