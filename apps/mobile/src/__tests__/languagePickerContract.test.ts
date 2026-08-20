import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translationKeys } from '../i18n';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const login = src('screens/LoginScreen.tsx');
const roleSelect = src('screens/RoleSelectScreen.tsx');
const auth = src('screens/AuthScreen.tsx');
const picker = src('components/LanguagePicker.tsx');
const helper = src('utils/showLanguageChoice.ts');
const settings = src('screens/MapScreen/components/SettingsOverlay.tsx');
const iosMenu = readFileSync(
  join(__dirname, '../../modules/hither-menu/ios/HitherMenuModule.swift'),
  'utf8',
);
const androidMenu = readFileSync(
  join(
    __dirname,
    '../../modules/hither-menu/android/src/main/java/expo/modules/hithermenu/HitherMenuModule.kt',
  ),
  'utf8',
);

describe('language picker placement contract', () => {
  it('shows LanguagePicker on Login without hiding it behind a session', () => {
    expect(login).toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(login).toContain('<LanguagePicker');
    expect(login).not.toContain('variant="menu"');
    expect(login).not.toMatch(/user\s*\?[\s\S]{0,80}<LanguagePicker/);
  });

  it('shows LanguagePicker on RoleSelect even when user is null', () => {
    expect(roleSelect).toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(roleSelect).toContain('<LanguagePicker');
    expect(roleSelect).toContain('variant="menu"');
    const pickerAt = roleSelect.indexOf('<LanguagePicker');
    const gatedDelete = roleSelect.indexOf("{user ?");
    expect(pickerAt).toBeGreaterThanOrEqual(0);
    expect(gatedDelete).toBeGreaterThan(pickerAt);
  });

  it('places RoleSelect language menu on the left cluster next to Back', () => {
    expect(roleSelect).toContain('variant="menu"');
    expect(roleSelect).toMatch(/canGoBack\(\)/);
    expect(roleSelect).toContain('leftChrome');
    expect(roleSelect).toMatch(/left:\s*20/);
    expect(roleSelect).toMatch(/flexDirection:\s*'row'/);
    expect(roleSelect).toMatch(/right:\s*20/);
    expect(roleSelect).toContain("'role_select.sign_out'");
    expect(roleSelect).not.toContain('langChrome');
    expect(roleSelect).not.toContain('切換語言');
    expect(roleSelect).not.toContain('ActionSheetIOS');
  });

  it('does not show LanguagePicker on Auth for leader or follower', () => {
    expect(auth).not.toMatch(/from ['"]\.\.\/components\/LanguagePicker['"]/);
    expect(auth).not.toContain('<LanguagePicker');
    expect(auth).not.toContain('confirmDeleteAccount');
    expect(auth).toContain("route.params?.role");
    expect(auth).toContain('isLeader');
  });

  it('writes existing setLanguage and only offers zh/en', () => {
    expect(picker).toContain('setLanguage');
    expect(picker).toContain('LANGUAGE_CHOICES');
    expect(picker).toContain("variant = 'segmented'");
    expect(picker).toContain("variant === 'menu'");
    expect(picker).toContain('chevron-down');
    expect(picker).toContain('NativeMenuHost');
    expect(picker).toContain('lightTap');
    expect(picker).not.toContain('showLanguageChoice(');
    expect(helper).toContain("key: 'zh'");
    expect(helper).toContain("key: 'en'");
    expect(helper).toContain("'中文'");
    expect(helper).toContain("'English'");
    expect(picker).not.toMatch(/reloadAsync|Updates\.reload|restart/i);
    expect(helper).not.toMatch(/reloadAsync|Updates\.reload|restart/i);
    expect(picker).not.toContain('Platform.OS');
    expect(picker).not.toContain('切換語言');
  });

  it('opens the RoleSelect menu only through hither-menu UIMenu', () => {
    const menu = src('native/menu.ts');
    expect(menu).toContain("requireOptionalNativeModule('HitherMenu')");
    expect(menu).toContain('requireNativeViewManager');
    expect(menu).toContain('isNativeMenuAvailable');
    expect(picker).toContain('NativeMenuHost');
    expect(picker).not.toContain('ActionSheetIOS');
    expect(picker).not.toContain('Alert.alert');
    expect(picker).not.toContain('showLanguageChoice(');
    expect(roleSelect).not.toContain('ActionSheetIOS');
    expect(iosMenu).toContain('showsMenuAsPrimaryAction');
    expect(iosMenu).toContain('UIMenu');
    expect(androidMenu).toContain('PopupMenu');
    expect(androidMenu).not.toContain('Dialog');
    expect(androidMenu).not.toContain('BottomSheet');
  });

  it('keeps Settings language as a NavRow that pushes a right-slide child', () => {
    expect(settings).toContain("t('settings.language')");
    expect(settings).toContain("setPage('language')");
    expect(settings).toContain("setPage('theme')");
    expect(settings).toContain('chevron-back');
    expect(settings).toContain('settings-slide-page');
    expect(settings).not.toContain('<Segmented');
    expect(settings).not.toContain('LanguagePicker');
    expect(settings).toContain('<OverlaySheet');
    expect(settings).toContain('setLanguage');
  });

  it('keeps zh/en catalogs key-identical after picker keys', () => {
    expect(translationKeys('en')).toEqual(translationKeys('zh'));
    expect(translationKeys('zh')).toContain('settings.language');
  });
});
