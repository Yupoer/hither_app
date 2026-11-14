import type { Language } from './PreferencesContext';

export function languageForLocale(locale: unknown): Language | null {
  if (typeof locale !== 'string') return null;
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === 'zh' || language === 'en' ? language : null;
}
