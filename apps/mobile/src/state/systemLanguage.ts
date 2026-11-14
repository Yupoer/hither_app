import type { Language } from './PreferencesContext';

export function readSystemLanguage(): Language {
  return 'zh';
}

export function subscribeSystemLanguage(_onChange: (language: Language) => void): () => void {
  return () => undefined;
}
