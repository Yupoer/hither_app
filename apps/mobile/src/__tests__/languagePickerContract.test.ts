import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translationKeys } from '../i18n';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const login = src('screens/LoginScreen.tsx');
const roleSelect = src('screens/RoleSelectScreen.tsx');
const auth = src('screens/AuthScreen.tsx');
const picker = src('components/LanguagePicker.tsx');
const settings = src('screens/MapScreen/components/SettingsOverlay.tsx');

describe('language picker placement contract', () => {
  it('shows LanguagePicker on Login without hiding it behind a session', () => {
    expect(login).toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(login).toContain('<LanguagePicker');
    expect(login).not.toMatch(/user\s*\?[\s\S]{0,80}<LanguagePicker/);
  });

  it('shows LanguagePicker on RoleSelect even when user is null', () => {
    expect(roleSelect).toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(roleSelect).toContain('<LanguagePicker');
    const pickerAt = roleSelect.indexOf('<LanguagePicker');
    const gatedDelete = roleSelect.indexOf("{user ?");
    expect(pickerAt).toBeGreaterThanOrEqual(0);
    expect(gatedDelete).toBeGreaterThan(pickerAt);
  });

  it('shows LanguagePicker on Auth for both leader and follower', () => {
    expect(auth).toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(auth).toContain('<LanguagePicker');
    expect(auth).toContain("route.params?.role");
    expect(auth).toContain('isLeader');
    const pickerAt = auth.indexOf('<LanguagePicker');
    const gatedDelete = auth.indexOf("{user ?");
    expect(pickerAt).toBeGreaterThanOrEqual(0);
    expect(gatedDelete).toBeGreaterThan(pickerAt);
  });

  it('writes existing setLanguage and only offers zh/en', () => {
    expect(picker).toContain('setLanguage');
    expect(picker).toContain("key: 'zh'");
    expect(picker).toContain("key: 'en'");
    expect(picker).toContain("'中文'");
    expect(picker).toContain("'English'");
    expect(picker).not.toMatch(/reloadAsync|Updates\.reload|restart/i);
  });

  it('keeps Settings overlay on Segmented language control', () => {
    expect(settings).toContain("t('settings.language')");
    expect(settings).toContain('<Segmented');
    expect(settings).toContain('setLanguage');
    expect(settings).not.toContain('LanguagePicker');
  });

  it('keeps zh/en catalogs key-identical after picker keys', () => {
    expect(translationKeys('en')).toEqual(translationKeys('zh'));
    expect(translationKeys('zh')).toContain('settings.language');
  });
});
