import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translationKeys } from '../i18n';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const login = src('screens/LoginScreen.tsx');
const teamEntry = src('screens/MyTeamsScreen.tsx');
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
  it('uses the shared language on the welcome, login, and team sheets', () => {
    for (const screen of [login, teamEntry, auth]) {
      expect(screen).toContain('useTranslation()');
      expect(screen).not.toContain('<LanguagePicker');
    }
  });

  it('writes existing setLanguage and only offers zh/en', () => {
    expect(picker).toContain('setLanguage');
    expect(picker).toContain('LANGUAGE_CHOICES');
    expect(picker).toContain("variant = 'segmented'");
    expect(picker).toContain("variant === 'menu'");
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

  it('uses hither-menu in the reusable language control', () => {
    const menu = src('native/menu.ts');
    expect(menu).toContain("requireOptionalNativeModule('HitherMenu')");
    expect(menu).toContain('requireNativeViewManager');
    expect(menu).toContain('isNativeMenuAvailable');
    expect(picker).toContain('NativeMenuHost');
    expect(picker).not.toContain('ActionSheetIOS');
    expect(picker).not.toContain('Alert.alert');
    expect(picker).not.toContain('showLanguageChoice(');
    expect(iosMenu).toContain('showsMenuAsPrimaryAction');
    expect(iosMenu).toContain('UIMenu');
    expect(androidMenu).toContain('PopupMenu');
    expect(androidMenu).not.toContain('Dialog');
    expect(androidMenu).not.toContain('BottomSheet');
  });

  it('keeps Settings language as a NavRow that opens a child sheet', () => {
    expect(settings).toContain("t('settings.language')");
    expect(settings).toContain("setPage('language')");
    expect(settings).toContain("setPage('theme')");
    expect(settings).toContain('settings-slide-page');
    expect(settings).not.toContain('<Segmented');
    expect(settings).not.toContain('LanguagePicker');
    expect(settings).toContain('<SettingsChildSheet');
    expect(settings).not.toContain('<OverlaySheet');
    expect(settings).toContain('setLanguage');
  });

  it('keeps zh/en catalogs key-identical after picker keys', () => {
    expect(translationKeys('en')).toEqual(translationKeys('zh'));
    expect(translationKeys('zh')).toContain('settings.language');
  });
});
