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

/**
 * In-app text size multiplier (Settings). Applied to design fontSize / layout
 * chrome only — not as a second system Dynamic Type scale. Emoji avatars ignore this.
 * Range: 0.8 (smallest) … 1.2 (largest). Default 1.0 = design sizes.
 */
export type TextScalePref = 0.8 | 0.9 | 1.0 | 1.1 | 1.2;
export const TEXT_SCALE_OPTIONS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;
export const DEFAULT_TEXT_SCALE: TextScalePref = 1.0;

const LANGUAGE_KEY = 'pref.language';
const THEME_KEY = 'pref.theme';
const TEXT_SCALE_KEY = 'pref.textScale';
const HIGH_ACCURACY_KEY = 'pref.highAccuracy';
const OBLIQUE_LOCATE_KEY = 'pref.obliqueLocate';
const LIVE_ACTIVITY_KEY = 'pref.liveActivity';
const MEET_RED_KEY = 'pref.meetRedMin';
const DAY_COLORS_KEY = 'pref.dayColors';
const GATHER_CARD_DEFAULT_EXPANDED_KEY = 'pref.gatherCardDefaultExpanded';

/** Minutes-remaining at which the meet-time countdown turns red. */
export const MEET_RED_OPTIONS = [3, 5, 10] as const;
export const DEFAULT_MEET_RED_MIN = 5;

interface PreferencesValue {
  language: Language;
  themeName: ThemeName;
  /** App text size multiplier (0.8–1.2). Default 1.0 = design sizes. */
  textScale: TextScalePref;
  /** Opt-in location tracking with finer fixes and a faster cadence. */
  highAccuracy: boolean;
  /** When true, locate-me tilts the camera to a 45° oblique view. */
  obliqueLocate: boolean;
  /** When true, start iOS Live Activity during an active journey. Default on. */
  liveActivityEnabled: boolean;
  /** Countdown turns red when this many minutes (or fewer) remain. */
  meetRedMin: number;
  /** Custom colors for each day */
  dayColors: Record<number, string>;
  /** Default gathering-card density on this device. */
  gatherCardDefaultExpanded: boolean;
  /** True once the persisted preferences have been loaded from storage. */
  ready: boolean;
  setLanguage: (language: Language) => void;
  setThemeName: (theme: ThemeName) => void;
  setTextScale: (scale: TextScalePref) => void;
  setHighAccuracy: (on: boolean) => void;
  setObliqueLocate: (on: boolean) => void;
  setLiveActivityEnabled: (on: boolean) => void;
  setMeetRedMin: (min: number) => void;
  setDayColor: (day: number, color: string) => void;
  setGatherCardDefaultExpanded: (expanded: boolean) => void;
}

const PreferencesContext = createContext<PreferencesValue | undefined>(undefined);

function isLanguage(value: string | null): value is Language {
  return value === 'zh' || value === 'en';
}

function isThemeName(value: string | null): value is ThemeName {
  return value != null && Object.prototype.hasOwnProperty.call(themes, value);
}

function parseTextScalePref(value: string | null): TextScalePref | null {
  if (value == null) return null;
  const n = Number(value);
  return (TEXT_SCALE_OPTIONS as readonly number[]).includes(n)
    ? (n as TextScalePref)
    : null;
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [themeName, setThemeNameState] = useState<ThemeName>(DEFAULT_THEME);
  const [textScale, setTextScaleState] = useState<TextScalePref>(DEFAULT_TEXT_SCALE);
  const [highAccuracy, setHighAccuracyState] = useState(false);
  // Default on: locate-me tilts to 45° unless the user opts out in Settings.
  const [obliqueLocate, setObliqueLocateState] = useState(true);
  // Default on: Live Activity during journey unless the user opts out.
  const [liveActivityEnabled, setLiveActivityEnabledState] = useState(true);
  const [meetRedMin, setMeetRedMinState] = useState<number>(DEFAULT_MEET_RED_MIN);
  const [dayColors, setDayColorsState] = useState<Record<number, string>>({});
  const [gatherCardDefaultExpanded, setGatherCardDefaultExpandedState] = useState(false);
  const [ready, setReady] = useState(false);

  // Restore persisted preferences on launch.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [
          storedLang,
          storedTheme,
          storedTextScale,
          storedHighAccuracy,
          storedObliqueLocate,
          storedLiveActivity,
          storedMeetRed,
          storedDayColors,
          storedGatherCardDefaultExpanded,
        ] = await AsyncStorage.multiGet([
          LANGUAGE_KEY,
          THEME_KEY,
          TEXT_SCALE_KEY,
          HIGH_ACCURACY_KEY,
          OBLIQUE_LOCATE_KEY,
          LIVE_ACTIVITY_KEY,
          MEET_RED_KEY,
          DAY_COLORS_KEY,
          GATHER_CARD_DEFAULT_EXPANDED_KEY,
        ]);
        if (!active) return;
        if (isLanguage(storedLang[1])) setLanguageState(storedLang[1]);
        if (isThemeName(storedTheme[1])) setThemeNameState(storedTheme[1]);
        const parsedTextScale = parseTextScalePref(storedTextScale[1]);
        if (parsedTextScale != null) setTextScaleState(parsedTextScale);
        if (storedHighAccuracy[1] === 'true') setHighAccuracyState(true);
        // Only override default-on when the user has explicitly stored a value.
        if (storedObliqueLocate[1] === 'false') setObliqueLocateState(false);
        else if (storedObliqueLocate[1] === 'true') setObliqueLocateState(true);
        if (storedLiveActivity[1] === 'false') setLiveActivityEnabledState(false);
        else if (storedLiveActivity[1] === 'true') setLiveActivityEnabledState(true);
        const red = Number(storedMeetRed[1]);
        if ((MEET_RED_OPTIONS as readonly number[]).includes(red)) setMeetRedMinState(red);
        if (storedDayColors[1]) {
          try {
            setDayColorsState(JSON.parse(storedDayColors[1]));
          } catch {}
        }
        if (storedGatherCardDefaultExpanded[1] === 'true') {
          setGatherCardDefaultExpandedState(true);
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

  const setTextScale = useCallback((next: TextScalePref) => {
    setTextScaleState(next);
    void AsyncStorage.setItem(TEXT_SCALE_KEY, String(next));
  }, []);

  const setHighAccuracy = useCallback((on: boolean) => {
    setHighAccuracyState(on);
    void AsyncStorage.setItem(HIGH_ACCURACY_KEY, on ? 'true' : 'false');
  }, []);

  const setObliqueLocate = useCallback((on: boolean) => {
    setObliqueLocateState(on);
    void AsyncStorage.setItem(OBLIQUE_LOCATE_KEY, on ? 'true' : 'false');
  }, []);

  const setLiveActivityEnabled = useCallback((on: boolean) => {
    setLiveActivityEnabledState(on);
    void AsyncStorage.setItem(LIVE_ACTIVITY_KEY, on ? 'true' : 'false');
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

  const setGatherCardDefaultExpanded = useCallback((expanded: boolean) => {
    setGatherCardDefaultExpandedState(expanded);
    void AsyncStorage.setItem(
      GATHER_CARD_DEFAULT_EXPANDED_KEY,
      expanded ? 'true' : 'false',
    );
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      language,
      themeName,
      textScale,
      highAccuracy,
      obliqueLocate,
      liveActivityEnabled,
      meetRedMin,
      dayColors,
      gatherCardDefaultExpanded,
      ready,
      setLanguage,
      setThemeName,
      setTextScale,
      setHighAccuracy,
      setObliqueLocate,
      setLiveActivityEnabled,
      setMeetRedMin,
      setDayColor,
      setGatherCardDefaultExpanded,
    }),
    [
      language,
      themeName,
      textScale,
      highAccuracy,
      obliqueLocate,
      liveActivityEnabled,
      meetRedMin,
      dayColors,
      gatherCardDefaultExpanded,
      ready,
      setLanguage,
      setThemeName,
      setTextScale,
      setHighAccuracy,
      setObliqueLocate,
      setLiveActivityEnabled,
      setMeetRedMin,
      setDayColor,
      setGatherCardDefaultExpanded,
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
