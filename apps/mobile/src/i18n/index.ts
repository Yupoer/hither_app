import { useMemo } from 'react';
import { usePreferences, type Language } from '../state/PreferencesContext';
import { en } from './locales/en';
import { zh } from './locales/zh';

/**
 * Lightweight in-app i18n.
 *
 * Each language owns a complete catalog under `locales/`. Screens read copy via
 * `useTranslation()`, which resolves against the language in PreferencesContext.
 *
 * `t(key, params)` does simple `{name}`-style interpolation. Units rendered by
 * `utils/geo` (e.g. "320 m · about 4 min walk") stay as-is — they are
 * locale-neutral measurements.
 *
 * Expand phase: locale files are complete; call sites keep using this module.
 */

type Dict = Record<string, string>;

export const translations: Record<Language, Dict> = {
  zh: zh as Dict,
  en: en as Dict,
};

/**
 * Public key type for `t()`. Kept as `keyof` the runtime catalog map so existing
 * call sites that pass dynamic keys stay type-compatible (expand phase).
 */
export type TranslationKey = keyof typeof translations.zh;

/** Interpolate `{name}` placeholders from `params`. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Resolve a key against an explicit language catalog.
 * Call sites that cannot use hooks (or tests) should use this; screens use
 * `useTranslation()`, which re-resolves when Preferences language changes.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = translations[language];
  return interpolate(dict[key] ?? translations.zh[key] ?? key, params);
}

export interface Translator {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  language: Language;
}

/** Resolve user-facing strings against the active language. */
export function useTranslation(): Translator {
  const { language } = usePreferences();
  const dict = translations[language];
  return useMemo(() => ({
    language,
    t: (key, params) => translate(language, key, params),
  }), [dict, language]);
}

/** Flat key list for catalog-contract tests (sorted, unique). */
export function translationKeys(language: Language = 'zh'): string[] {
  return Object.keys(translations[language]).sort();
}
