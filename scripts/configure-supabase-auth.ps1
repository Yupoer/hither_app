[CmdletBinding()]
param(
  [switch]$DryRun,
  [ValidateSet('brevo', 'gmail')]
  [string]$SmtpProvider = 'brevo'
)

$ErrorActionPreference = 'Stop'
$projectRef = 'htqrucnjafhhvxdqslbv'
$authEndpoint = "https://api.supabase.com/v1/projects/$projectRef/config/auth"

function Require-EnvironmentValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment variable is missing: $Name"
  }
  return $value
}

$supabaseToken = Require-EnvironmentValue 'SUPABASE_ACCESS_TOKEN'
$iosClientId = [Environment]::GetEnvironmentVariable('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID')
$smtpHost = ''
$smtpPort = 0
$smtpUser = ''
$smtpKey = ''
$senderEmail = ''
$brevoApiKey = ''
if ($SmtpProvider -eq 'brevo') {
  $brevoApiKey = Require-EnvironmentValue 'BREVO_API_KEY'
  $smtpHost = 'smtp-relay.brevo.com'
  $smtpPort = 587
  $smtpUser = Require-EnvironmentValue 'BREVO_SMTP_USER'
  $smtpKey = Require-EnvironmentValue 'BREVO_SMTP_KEY'
  $senderEmail = Require-EnvironmentValue 'BREVO_SENDER_EMAIL'
} else {
  $smtpHost = Require-EnvironmentValue 'SMTP_HOST'
  $smtpPortText = Require-EnvironmentValue 'SMTP_PORT'
  if (-not [int]::TryParse($smtpPortText, [ref]$smtpPort) -or $smtpPort -lt 1 -or $smtpPort -gt 65535) {
    throw 'SMTP_PORT must be an integer between 1 and 65535.'
  }
  $smtpUser = Require-EnvironmentValue 'SMTP_USER'
  $smtpKey = Require-EnvironmentValue 'SMTP_PASSWORD'
  $smtpKey = $smtpKey -replace '\s', ''
  $senderEmail = Require-EnvironmentValue 'SMTP_SENDER_EMAIL'
}

$supabaseHeaders = @{
  Authorization = "Bearer $supabaseToken"
  Accept = 'application/json'
}
$brevoHeaders = @{}
if ($SmtpProvider -eq 'brevo') {
  $brevoHeaders = @{
    'api-key' = $brevoApiKey
    Accept = 'application/json'
  }
}

Write-Output "Supabase project: $projectRef"
Write-Output "SMTP provider: $SmtpProvider"
$current = Invoke-RestMethod -Method Get -Uri $authEndpoint -Headers $supabaseHeaders
Write-Output 'Read current Auth configuration.'

if (-not $DryRun) {
  try {
    if ($SmtpProvider -eq 'brevo') {
      $account = Invoke-RestMethod -Method Get -Uri 'https://api.brevo.com/v3/account' -Headers $brevoHeaders
      if (-not $account.email) { throw 'Brevo account response did not contain an email.' }
      $senders = Invoke-RestMethod -Method Get -Uri 'https://api.brevo.com/v3/senders?limit=50&offset=0' -Headers $brevoHeaders
      $sender = @($senders.senders) | Where-Object { $_.email -ieq $senderEmail } | Select-Object -First 1
      if (-not $sender -or $sender.active -ne $true) {
        throw "Brevo sender is missing or not active: $senderEmail"
      }
      Write-Output 'Brevo API key and verified sender check passed.'
    }

    $smtp = [System.Net.Mail.SmtpClient]::new($smtpHost, $smtpPort)
    $smtp.EnableSsl = $true
    $smtp.Credentials = [System.Net.NetworkCredential]::new($smtpUser, $smtpKey)
    $message = [System.Net.Mail.MailMessage]::new()
    $message.From = $senderEmail
    $message.To.Add($senderEmail)
    $message.Subject = 'Hither SMTP test / Hither SMTP 測試'
    $message.Body = 'This is a one-time SMTP delivery test for Hither / 這是 Hither 的一次性 SMTP 寄信測試。'
    try {
      $smtp.Send($message)
    } finally {
      $message.Dispose()
      $smtp.Dispose()
    }
    Write-Output "$SmtpProvider SMTP delivery test passed."
  } catch {
    throw "$SmtpProvider SMTP preflight failed; production Auth was not changed. $($_.Exception.Message)"
  }
} else {
  Write-Output "Dry run: skipped $SmtpProvider preflight and SMTP delivery."
}

$allowList = @()
if ($current.uri_allow_list) {
  $allowList += ([string]$current.uri_allow_list -split "[,`r`n]+" | Where-Object { $_.Trim() })
}
$allowList += 'hither://auth/callback'
$allowList += 'hither://auth/recovery'
$allowList = @($allowList | ForEach-Object { $_.Trim() } | Select-Object -Unique)

$confirmationTemplate = @(
  '<h2>Verify your Hither email / 驗證你的 Hither 電子信箱</h2>'
  '<p>Confirm your email address to finish creating your Hither account. / 請驗證電子信箱以完成 Hither 帳號建立。</p>'
  '<p><a href="{{ .ConfirmationURL }}">Verify email / 驗證電子信箱</a></p>'
) -join "`n"
$recoveryTemplate = @(
  '<h2>Reset your Hither password / 重設 Hither 密碼</h2>'
  '<p>Use the link below to choose a new password. / 請使用下方連結設定新密碼。</p>'
  '<p><a href="{{ .ConfirmationURL }}">Reset password / 重設密碼</a></p>'
  '<p>If you did not request this, you can ignore this email. / 如果不是你提出的要求，可以忽略這封信。</p>'
) -join "`n"

$patchBody = [ordered]@{
  external_email_enabled = $true
  mailer_autoconfirm = $false
  mailer_secure_email_change_enabled = $true
  smtp_host = $smtpHost
  smtp_port = [string]$smtpPort
  smtp_user = $smtpUser
  smtp_pass = $smtpKey
  smtp_admin_email = $senderEmail
  smtp_sender_name = 'Hither'
  mailer_subjects_confirmation = 'Verify your Hither email / 驗證你的 Hither 電子信箱'
  mailer_subjects_recovery = 'Reset your Hither password / 重設 Hither 密碼'
  mailer_templates_confirmation_content = $confirmationTemplate
  mailer_templates_recovery_content = $recoveryTemplate
  uri_allow_list = ($allowList -join ',')
}

# Supabase accepts a comma-separated additional-client-id string. Preserve the
# existing Web client ID/provider and add the iOS audience only when it differs.
$existingGoogleClientId = [string]$current.external_google_client_id
$existingAdditional = @()
if ($current.external_google_additional_client_ids) {
  $existingAdditional = @([string]$current.external_google_additional_client_ids -split '[,\s]+' | Where-Object { $_ })
}
if ($iosClientId -and $existingGoogleClientId -and $iosClientId -ne $existingGoogleClientId -and
    $existingAdditional -notcontains $iosClientId) {
  $patchBody.external_google_additional_client_ids = @($existingAdditional + $iosClientId) -join ','
}

Write-Output ('PATCH fields: ' + (($patchBody.Keys | ForEach-Object { $_ }) -join ', '))
Write-Output 'Secret values are not printed.'

if ($DryRun) {
  Write-Output 'Dry run complete; no production Auth configuration was changed.'
  exit 0
}

$json = $patchBody | ConvertTo-Json -Depth 8
$patchHeaders = $supabaseHeaders.Clone()
$patchHeaders['Content-Type'] = 'application/json'
Invoke-RestMethod -Method Patch -Uri $authEndpoint -Headers $patchHeaders -Body $json | Out-Null
$verified = Invoke-RestMethod -Method Get -Uri $authEndpoint -Headers $supabaseHeaders

if ($verified.external_email_enabled -ne $true -or
    $verified.mailer_autoconfirm -ne $false -or
    $verified.smtp_host -ne $smtpHost -or
    $verified.smtp_admin_email -ine $senderEmail -or
    -not ([string]$verified.smtp_pass)) {
  throw 'Supabase Auth read-back did not match the requested email configuration.'
}
$verifiedAllowList = @([string]$verified.uri_allow_list -split "[,`r`n]+" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($verifiedAllowList -notcontains 'hither://auth/callback') {
  throw 'Supabase Auth read-back is missing hither://auth/callback.'
}
if ($verifiedAllowList -notcontains 'hither://auth/recovery') {
  throw 'Supabase Auth read-back is missing hither://auth/recovery.'
}

Write-Output 'Supabase Auth configuration updated and verified.'
