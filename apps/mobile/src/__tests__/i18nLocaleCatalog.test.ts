/**
 * Ticket 01 — split locale catalog foundation.
 * External behavior: complete per-language catalogs, identical keys, param
 * interpolation, and language-aware resolution without app restart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  translate,
  translationKeys,
  translations,
} from '../i18n';

const i18nIndex = readFileSync(join(__dirname, '../i18n/index.ts'), 'utf8');
const zhSource = readFileSync(join(__dirname, '../i18n/locales/zh.ts'), 'utf8');
const enSource = readFileSync(join(__dirname, '../i18n/locales/en.ts'), 'utf8');

describe('locale catalog foundation', () => {
  it('keeps zh and en as independent complete locale files', () => {
    expect(zhSource).toMatch(/export const zh/);
    expect(enSource).toMatch(/export const en/);
    expect(i18nIndex).toMatch(/from '\.\/locales\/zh'/);
    expect(i18nIndex).toMatch(/from '\.\/locales\/en'/);
    // Catalog bodies no longer live in the public entry.
    expect(i18nIndex).not.toMatch(/const zh = \{/);
    expect(i18nIndex).not.toMatch(/const en(?::[^=]+)? = \{/);
  });

  it('requires zh and en key sets to be identical', () => {
    const zhKeys = translationKeys('zh');
    const enKeys = translationKeys('en');

    expect(zhKeys.length).toBeGreaterThan(100);
    expect(enKeys).toEqual(zhKeys);

    const missingEn = zhKeys.filter((key) => translations.en[key] == null);
    const missingZh = enKeys.filter((key) => translations.zh[key] == null);
    expect(missingEn).toEqual([]);
    expect(missingZh).toEqual([]);
  });

  it('keeps existing translate / param substitution behavior', () => {
    expect(translate('zh', 'common.cancel')).toBe('取消');
    expect(translate('en', 'common.cancel')).toBe('Cancel');

    expect(translate('zh', 'anon.expiryUntil', { date: '2026-08-06' })).toBe(
      translations.zh['anon.expiryUntil'].replace('{date}', '2026-08-06'),
    );
    expect(translate('en', 'anon.expiryUntil', { date: '2026-08-06' })).toBe(
      translations.en['anon.expiryUntil'].replace('{date}', '2026-08-06'),
    );

    // Unknown placeholders stay in the string (legacy interpolate contract).
    expect(translate('en', 'anon.expiryUntil', {})).toContain('{date}');
  });

  it('re-resolves copy from the active language without requiring a restart path', () => {
    // useTranslation reads Preferences language and memoizes on [dict, language].
    // Switching language is a pure catalog re-resolution — no process restart.
    expect(i18nIndex).toMatch(/usePreferences\(\)/);
    expect(i18nIndex).toMatch(/useMemo\(\(\) => \(\{/);
    expect(i18nIndex).toContain('}), [dict, language]');

    const before = translate('zh', 'common.confirm');
    const after = translate('en', 'common.confirm');
    expect(before).toBe('確認');
    expect(after).toBe('Confirm');
    expect(before).not.toBe(after);
  });
});
