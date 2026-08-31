import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const script = readFileSync(join(root, 'scripts/configure-supabase-auth.ps1'), 'utf8');

describe('Supabase Auth configuration script contract', () => {
  it('fails closed on missing local credentials and supports dry-run', () => {
    for (const name of ['SUPABASE_ACCESS_TOKEN', 'BREVO_API_KEY', 'BREVO_SMTP_USER', 'BREVO_SMTP_KEY', 'BREVO_SENDER_EMAIL']) {
      expect(script).toContain(`Require-EnvironmentValue '${name}'`);
    }
    expect(script).toContain('[switch]$DryRun');
    expect(script).toContain('Dry run complete');
    expect(script).toContain('Secret values are not printed.');
    expect(script).not.toContain('Write-Output $smtpKey');
    expect(script).not.toContain('Write-Output $brevoApiKey');
  });

  it('supports Gmail SMTP without requiring a Brevo API key', () => {
    expect(script).toContain("[ValidateSet('brevo', 'gmail')]");
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SENDER_EMAIL']) {
      expect(script).toContain(`Require-EnvironmentValue '${name}'`);
    }
    expect(script).toContain("$smtpHost = Require-EnvironmentValue 'SMTP_HOST'");
    expect(script).toContain("uri_allow_list = ($allowList -join ',')");
  });

  it('tests Brevo before the minimal Auth PATCH and preserves unrelated providers', () => {
    expect(script).toContain("https://api.brevo.com/v3/account");
    expect(script).toContain('smtp-relay.brevo.com');
    expect(script).toContain('smtpKey');
    expect(script).toContain('Invoke-RestMethod -Method Patch');
    expect(script).toContain('mailer_templates_confirmation_content');
    expect(script).toContain('mailer_templates_recovery_content');
    expect(script).toContain('external_google_additional_client_ids');
    expect(script).not.toContain('external_apple');
    expect(script).not.toContain('external_anonymous_users_enabled');
  });
});
