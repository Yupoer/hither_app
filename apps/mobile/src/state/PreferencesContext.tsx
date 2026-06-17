import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_THEME,
  themes,
  type Palette,
  type ThemeName,
} from '../theme';

/**
 * Device-local user preferences: the UI language and the colour theme.
 *
 * These are personal display settings (not group state), so they live outside
 * the session/group contexts and persist to AsyncStorage — a relaunch restores
 * the user's last language/theme. The values are read by `useTheme()` (palette)
 * and `useTranslation()` (strings); changing them re-renders the whole tree.
 */

/** Supported UI languages. */
export type Language = 'zh' | 'en';

export const DEFAULT_LANGUAGE: Language = 'zh';

const LANGUAGE_KEY = 'pref.language';
const THEME_KEY = 'pref.theme';

interface PreferencesValue {
  language: Language;
  themeName: ThemeName;
  /** True once the persisted preferences have been loaded from storage. */
  ready: boolean;
  setLanguage: (language: Language) => void;
  setThemeName: (theme: ThemeName) => void;
}

const PreferencesContext = createContext<PreferencesValue | undefined>(undefined);

function isLanguage(value: string | null): value is Language {
  return value === 'zh' || value === 'en';
}

function isThemeName(value: string | null): value is ThemeName {
  return value != null && Object.prototype.hasOwnProperty.call(themes, value);
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);

  // Restore persisted preferences on launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedLang, storedTheme] = await AsyncStorage.multiGet([
          LANGUAGE_KEY,
          THEME_KEY,
        ]);
        if (!active) return;
        if (isLanguage(storedLang[1])) setLanguageState(storedLang[1]);
        if (isThemeName(storedTheme[1])) setThemeNameState(storedTheme[1]);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    void AsyncStorage.setItem(LANGUAGE_KEY, next);
  }, []);

  const setThemeName = useCallback((next: ThemeName) => {
    setThemeNameState(next);
    void AsyncStorage.setItem(THEME_KEY, next);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({ language, themeName, ready, setLanguage, setThemeName }),
    [language, themeName, ready, setLanguage, setThemeName],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return ctx;
}

/**
 * The active colour palette plus its name. Screens build their styles from
 * `colors` (e.g. `useMemo(() => makeStyles(colors), [colors])`) so switching
 * the theme restyles the whole app.
 */
export function useTheme(): { colors: Palette; themeName: ThemeName } {
  const { themeName } = usePreferences();
  return { colors: themes[themeName], themeName };
}
