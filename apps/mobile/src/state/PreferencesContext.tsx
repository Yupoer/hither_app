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
const HIGH_ACCURACY_KEY = 'pref.highAccuracy';
const MEET_RED_KEY = 'pref.meetRedMin';
const DAY_COLORS_KEY = 'pref.dayColors';

/** Minutes-remaining at which the meet-time countdown turns red. */
export const MEET_RED_OPTIONS = [3, 5, 10] as const;
export const DEFAULT_MEET_RED_MIN = 5;

interface PreferencesValue {
  language: Language;
  themeName: ThemeName;
  /** Opt-in location tracking with finer fixes and a faster cadence. */
  highAccuracy: boolean;
  /** Countdown turns red when this many minutes (or fewer) remain. */
  meetRedMin: number;
  /** Custom colors for each day */
  dayColors: Record<number, string>;
  /** True once the persisted preferences have been loaded from storage. */
  ready: boolean;
  setLanguage: (language: Language) => void;
  setThemeName: (theme: ThemeName) => void;
  setHighAccuracy: (on: boolean) => void;
  setMeetRedMin: (min: number) => void;
  setDayColor: (day: number, color: string) => void;
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
  const [highAccuracy, setHighAccuracyState] = useState(false);
  const [meetRedMin, setMeetRedMinState] = useState<number>(DEFAULT_MEET_RED_MIN);
  const [dayColors, setDayColorsState] = useState<Record<number, string>>({});
  const [ready, setReady] = useState(false);

  // Restore persisted preferences on launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedLang, storedTheme, storedHighAccuracy, storedMeetRed, storedDayColors] =
          await AsyncStorage.multiGet([
            LANGUAGE_KEY,
            THEME_KEY,
            HIGH_ACCURACY_KEY,
            MEET_RED_KEY,
            DAY_COLORS_KEY,
          ]);
        if (!active) return;
        if (isLanguage(storedLang[1])) setLanguageState(storedLang[1]);
        if (isThemeName(storedTheme[1])) setThemeNameState(storedTheme[1]);
        if (storedHighAccuracy[1] === 'true') setHighAccuracyState(true);
        const red = Number(storedMeetRed[1]);
        if ((MEET_RED_OPTIONS as readonly number[]).includes(red)) setMeetRedMinState(red);
        if (storedDayColors[1]) {
          try {
            setDayColorsState(JSON.parse(storedDayColors[1]));
          } catch {}
        }
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

  const setHighAccuracy = useCallback((on: boolean) => {
    setHighAccuracyState(on);
    void AsyncStorage.setItem(HIGH_ACCURACY_KEY, on ? 'true' : 'false');
  }, []);

  const setMeetRedMin = useCallback((min: number) => {
    setMeetRedMinState(min);
    void AsyncStorage.setItem(MEET_RED_KEY, String(min));
  }, []);

  const setDayColor = useCallback((day: number, color: string) => {
    setDayColorsState((prev) => {
      const next = { ...prev, [day]: color };
      void AsyncStorage.setItem(DAY_COLORS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      language,
      themeName,
      highAccuracy,
      meetRedMin,
      dayColors,
      ready,
      setLanguage,
      setThemeName,
      setHighAccuracy,
      setMeetRedMin,
      setDayColor,
    }),
    [
      language,
      themeName,
      highAccuracy,
      meetRedMin,
      dayColors,
      ready,
      setLanguage,
      setThemeName,
      setHighAccuracy,
      setMeetRedMin,
      setDayColor,
    ],
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
