/**
 * Ticket 01 — split locale catalog foundation.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate, translationKeys, translations } from '../i18n';

const i18nIndex = readFileSync(join(__dirname, '../i18n/index.ts'), 'utf8');
const zhSource = readFileSync(join(__dirname, '../i18n/locales/zh.ts'), 'utf8');
const enSource = readFileSync(join(__dirname, '../i18n/locales/en.ts'), 'utf8');

describe('locale catalog foundation', () => {
  it('keeps zh and en as independent complete locale files', () => {
    expect(zhSource).toMatch(/export const zh/);
    expect(enSource).toMatch(/export const en/);
    expect(i18nIndex).toMatch(/from '\.\/locales\/zh'/);
    expect(i18nIndex).toMatch(/from '\.\/locales\/en'/);
    expect(i18nIndex).not.toMatch(/const zh = \{/);
    expect(i18nIndex).not.toMatch(/const en(?::[^=]+)? = \{/);
  });

  it('requires zh and en key sets to be identical', () => {
    const zhKeys = translationKeys('zh');
    const enKeys = translationKeys('en');
    expect(zhKeys.length).toBeGreaterThan(100);
    expect(enKeys).toEqual(zhKeys);
  });

  it('keeps translate / param substitution behavior', () => {
    expect(translate('zh', 'common.cancel')).toBe('取消');
    expect(translate('en', 'common.cancel')).toBe('Cancel');
    expect(translate('zh', 'anon.expiryUntil', { date: '2026-08-06' })).toBe(
      translations.zh['anon.expiryUntil'].replace('{date}', '2026-08-06'),
    );
    expect(translate('en', 'anon.expiryUntil', { date: '2026-08-06' })).toBe(
      translations.en['anon.expiryUntil'].replace('{date}', '2026-08-06'),
    );
  });

  it('re-resolves copy by language without restart path', () => {
    expect(i18nIndex).toMatch(/usePreferences\(\)/);
    expect(i18nIndex).toContain('}), [dict, language]');
    expect(translate('zh', 'common.confirm')).toBe('確認');
    expect(translate('en', 'common.confirm')).toBe('Confirm');
  });
});
