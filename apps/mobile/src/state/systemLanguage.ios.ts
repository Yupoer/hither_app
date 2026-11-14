import { AppState, Settings } from 'react-native';
import type { Language } from './PreferencesContext';
import { languageForLocale } from './languageForLocale';

export function readSystemLanguage(): Language {
  const preferred: unknown = Settings.get('AppleLanguages');
  if (Array.isArray(preferred)) {
    for (const locale of preferred) {
      const language = languageForLocale(locale);
      if (language) return language;
    }
  }
  return languageForLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'zh';
}

export function subscribeSystemLanguage(onChange: (language: Language) => void): () => void {
  const refresh = () => onChange(readSystemLanguage());
  const watch = Settings.watchKeys('AppleLanguages', refresh);
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') refresh();
  });
  return () => {
    Settings.clearWatch(watch);
    subscription.remove();
  };
}
