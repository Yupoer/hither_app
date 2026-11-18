import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const privacy = read('apps/legal-site/privacy/index.html');
const terms = read('apps/legal-site/terms/index.html');
const login = read('apps/mobile/src/screens/LoginScreen.tsx');
const premium = read('apps/mobile/src/components/PremiumPresentation.tsx');
const deploy = read('scripts/deploy-legal-site.ps1');
const locationSmoke = read('apps/mobile/scripts/location-smoke.cjs');
const appConfig = read('apps/mobile/app.config.ts');

describe('legal site contract', () => {
  it('discloses the app data and provider boundaries in both languages', () => {
    for (const keyword of ['電子信箱', '位置資料', '背景定位', '診斷資料', 'Supabase', 'Google', 'Apple', 'AdMob', 'StoreKit', '14 天']) {
      expect(privacy).toContain(keyword);
    }
    for (const keyword of ['Email', 'Location data', 'Background location', 'Diagnostics', 'Supabase', 'Google', 'Apple', 'AdMob', 'StoreKit', '14 days']) {
      expect(privacy).toContain(keyword);
    }
    expect(privacy).toContain('刪除帳號');
    expect(privacy).toContain('delete your account');
  });

  it('covers terms, contact injection, and production URL fail-closed checks', () => {
    for (const keyword of ['服務用途', '訪客模式', '使用者責任', 'Premium', '停權', '免責']) {
      expect(terms).toContain(keyword);
    }
    for (const keyword of ['Service purpose', 'guest mode', 'responsibilities', 'Premium', 'Suspension', 'Disclaimer']) {
      expect(terms).toContain(keyword);
    }
    expect(deploy).toContain('__CONTACT_EMAIL__');
    expect(deploy).toContain('BREVO_SENDER_EMAIL');
    expect(deploy).toContain('System.Text.UTF8Encoding');
    expect(deploy).toContain("-Filter '*.html'");
    expect(deploy).toContain('::ReadAllText');
    expect(deploy).toContain('::WriteAllText');
    expect(appConfig).toContain('Production legal links require HTTPS');
  });

  it('uses the deployed documents from both app surfaces', () => {
    expect(login).toContain('<LegalLink document="privacy"');
    expect(login).toContain('<LegalLink document="terms"');
    expect(premium).toContain("getLegalUrl('privacy')");
    expect(premium).toContain("getLegalUrl('terms')");
    expect(login).not.toContain('apple.com/legal/privacy');
    expect(premium).not.toContain('apple.com/legal/privacy');
  });

  it('keeps production credentials away from mutable command resolution', () => {
    expect(locationSmoke).toContain('await loadServiceRoleKey(env)');
    expect(locationSmoke).toContain('const workerEnv = smokeWorkerEnvironment(env)');
    expect(locationSmoke).not.toMatch(/\bnpx(?:\.cmd)?\b/);
    expect(deploy).toContain('$WranglerVersion');
    expect(deploy).toContain('$WranglerSha256');
    expect(deploy).toContain('verified-cli-tree.mjs');
    expect(deploy).toContain('node_modules\\wrangler\\bin\\wrangler.js');
    expect(deploy).toContain('$env:CLOUDFLARE_API_TOKEN = $cloudflareToken');
    expect(deploy).not.toContain("'NODE_OPTIONS'");
    expect(deploy).not.toMatch(/\bnpx(?:\.cmd)?\b|wrangler@latest/);
  });
});
