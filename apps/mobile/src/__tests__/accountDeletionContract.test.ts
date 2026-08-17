import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translationKeys } from '../i18n';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const roleSelect = src('screens/RoleSelectScreen.tsx');
const authScreen = src('screens/AuthScreen.tsx');
const accountSheet = src('components/AccountSheet.tsx');
const loginScreen = src('screens/LoginScreen.tsx');
const settingsOverlay = src('screens/MapScreen/components/SettingsOverlay.tsx');
const mapScreen = src('screens/MapScreen.tsx');
const inventory = src('__tests__/buttonInventoryContract.test.ts');

const DELETE_KEYS = [
  'account.delete',
  'account.deleteTitle',
  'account.deleteMsg',
  'account.deleteConfirm',
  'account.deleteFailed',
] as const;

describe('account deletion placement contract', () => {
  it('exposes confirmAction delete on RoleSelect, Auth, and AccountSheet behind user', () => {
    expect(roleSelect).toContain('confirmDeleteAccount');
    expect(roleSelect).toContain("'role_select.delete_account'");
    expect(roleSelect).toMatch(/user\s*\?[\s\S]*confirmDeleteAccount/);

    expect(authScreen).toContain('confirmDeleteAccount');
    expect(authScreen).toContain("'auth.delete_account'");
    expect(authScreen).toMatch(/user\s*\?[\s\S]*confirmDeleteAccount/);

    expect(accountSheet).toContain('confirmDeleteAccount');
    expect(accountSheet).toContain("'account.delete'");
    expect(accountSheet).toContain('onAccountDeleted');
    expect(accountSheet).toMatch(/user\s*\?[\s\S]*confirmDeleteAccount/);
    expect(mapScreen).toContain('onAccountDeleted');
    expect(mapScreen).toContain("name: 'Login'");
  });

  it('does not add delete on Login or Settings root', () => {
    expect(loginScreen).not.toContain('confirmDeleteAccount');
    expect(loginScreen).not.toContain("'account.delete'");
    expect(loginScreen).not.toContain("'role_select.delete_account'");
    expect(settingsOverlay).not.toContain('confirmDeleteAccount');
    expect(settingsOverlay).not.toContain("'account.delete'");
    expect(settingsOverlay).toContain("t('settings.signOut')");
  });

  it('registers the three high-risk delete actionIds', () => {
    expect(inventory).toContain("'account.delete'");
    expect(inventory).toContain("'role_select.delete_account'");
    expect(inventory).toContain("'auth.delete_account'");
  });

  it('adds matching zh/en account.delete catalog keys', () => {
    const zh = translationKeys('zh');
    const en = translationKeys('en');
    for (const key of DELETE_KEYS) {
      expect(zh).toContain(key);
      expect(en).toContain(key);
    }
    expect(en).toEqual(zh);
  });
});
