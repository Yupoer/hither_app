/**
 * #157 — user-visible store/currency copy uses coins (金幣), not Token.
 * Internal contracts (priceTokens, token_redemption key names, DB fields) stay unchanged.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { translate, translations } from '../i18n';

const root = join(__dirname, '..');
const zh = translations.zh;
const en = translations.en;

/** Keys whose values are product-currency display strings (must use coin wording). */
const COIN_DISPLAY_KEYS = [
  'store.balance',
  'store.balanceA11y',
  'store.adWatch',
  'store.adCredited',
  'store.adRewardHint',
  'store.registerHint',
  'store.priceTokens',
  'store.shortfall',
  'store.confirmPrice',
  'store.insufficientTitle',
  'store.insufficientBody',
  'account.premiumSource.token_redemption',
] as const;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (/\.(tsx?)$/.test(name)) out.push(full);
  }
  return out;
}

describe('coin display copy inventory (#157)', () => {
  it('store balance/cost keys use coin wording in zh and en', () => {
    for (const key of COIN_DISPLAY_KEYS) {
      const zhVal = zh[key];
      const enVal = en[key];
      expect(zhVal).toBeTruthy();
      expect(enVal).toBeTruthy();
      // Product currency: zh 金幣 / en coin(s). Not leftover "token" product term.
      expect(zhVal).toMatch(/金幣/);
      expect(zhVal).not.toMatch(/\b[Tt]oken\b/);
      expect(enVal.toLowerCase()).toMatch(/coin/);
      expect(enVal.toLowerCase()).not.toMatch(/\btokens?\b/);
    }
  });

  it('keeps internal key names and sample interpolated values', () => {
    // Key names stay token-based where that is the contract.
    expect(Object.prototype.hasOwnProperty.call(zh, 'store.priceTokens')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(zh, 'account.premiumSource.token_redemption')).toBe(true);
    expect(translate('zh', 'store.balance')).toBe('金幣餘額');
    expect(translate('en', 'store.balance')).toBe('Coin balance');
    expect(translate('zh', 'store.priceTokens', { count: 5 })).toBe('5 金幣');
    expect(translate('en', 'store.priceTokens', { count: 5 })).toBe('5 coins');
    expect(translate('zh', 'store.insufficientBody', { shortfall: 2 })).toBe('還差 2 金幣');
    expect(translate('en', 'store.insufficientBody', { shortfall: 2 })).toBe('Need 2 more coins');
  });

  it('does not hardcode 金幣 / Coin balance outside locale catalogs', () => {
    const uiRoots = [
      join(root, 'screens'),
      join(root, 'components'),
    ];
    const offenders: string[] = [];
    for (const base of uiRoots) {
      for (const file of walkTsFiles(base)) {
        const src = readFileSync(file, 'utf8');
        // Hardcoded product currency labels (locale files are the source of truth).
        if (/金幣餘額|Coin balance|Not enough tokens|Token 餘額|Token balance/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('diagnostics redaction notice may still say Token (sensitive data, not currency)', () => {
    expect(zh['diagnostics.redactionNotice']).toMatch(/Token/);
    expect(en['diagnostics.redactionNotice'].toLowerCase()).toMatch(/token/);
  });
});
