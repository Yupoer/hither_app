import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Dimensions,
  PixelRatio,
  Platform,
  useWindowDimensions,
  type AppStateStatus,
} from 'react-native';
import {
  cappedFontScale,
  fontScaleBucket,
  layoutFontScale,
  type FontScaleBucket,
} from '../theme/typeScale';
import { usePreferences } from '../state/PreferencesContext';

function readRawFontScale(): number {
  const fromPixel = PixelRatio.getFontScale();
  if (Number.isFinite(fromPixel) && fromPixel > 0) return fromPixel;
  return 1;
}

/**
 * Live system font scale (already capped to GLOBAL_FONT_SCALE_CAP).
 * Does NOT include the app Settings textScale — use {@link useFontScale} for layout.
 *
 * Text reflows natively when Dynamic Type changes; layout must re-render too.
 * Sources (most → least preferred):
 * 1. useWindowDimensions().fontScale — updates with RN dimension events
 * 2. PixelRatio + AppState / Dimensions listeners — catch Settings return path
 */
function useSystemFontScale(): number {
  const { fontScale: windowFontScale } = useWindowDimensions();
  const [polled, setPolled] = useState(readRawFontScale);

  const refresh = useCallback(() => {
    setPolled(readRawFontScale());
  }, []);

  useEffect(() => {
    refresh();
    const onApp = (state: AppStateStatus) => {
      if (state === 'active') refresh();
    };
    const appSub = AppState.addEventListener('change', onApp);
    const dimSub = Dimensions.addEventListener('change', refresh);
    return () => {
      appSub.remove();
      dimSub.remove();
    };
  }, [refresh]);

  // Prefer window metrics when RN provides a positive fontScale.
  const raw =
    Number.isFinite(windowFontScale) && windowFontScale > 0
      ? windowFontScale
      : polled;

  return cappedFontScale(raw);
}

/**
 * iOS Bold Text / Android high-contrast text.
 * Glyphs get wider without changing fontScale — layout must densify earlier.
 */
export function useBoldTextEnabled(): boolean {
  const [bold, setBold] = useState(false);

  useEffect(() => {
    let active = true;

    const read = () => {
      const probe = Platform.OS === 'android'
        ? AccessibilityInfo.isHighTextContrastEnabled?.()
        : AccessibilityInfo.isBoldTextEnabled();
      if (!probe) return;
      void probe
        .then((on) => {
          if (active) setBold(!!on);
        })
        .catch(() => {
          /* native module missing on some hosts — treat as off */
        });
    };

    read();

    const onApp = (state: AppStateStatus) => {
      if (state === 'active') read();
    };
    const appSub = AppState.addEventListener('change', onApp);

    // Event name differs by platform; fall back to AppState re-read.
    const eventName =
      Platform.OS === 'android' ? 'highTextContrastChanged' : 'boldTextChanged';
    let eventSub: { remove: () => void } | undefined;
    try {
      eventSub = AccessibilityInfo.addEventListener(
        eventName as 'boldTextChanged',
        (on: boolean) => {
          if (active) setBold(!!on);
        },
      );
    } catch {
      eventSub = undefined;
    }

    return () => {
      active = false;
      appSub.remove();
      eventSub?.remove();
    };
  }, []);

  return bold;
}

/**
 * Layout scale = capped(system Dynamic Type) × app Settings textScale × bold.
 * Use for minHeights, gaps, and chrome — not as Text fontSize when
 * allowFontScaling is also enabled (would double-apply system scale).
 */
export function useFontScale(): number {
  const system = useSystemFontScale();
  const boldText = useBoldTextEnabled();
  const { textScale } = usePreferences();
  return useMemo(
    () => layoutFontScale(system, textScale, boldText),
    [system, textScale, boldText],
  );
}

/**
 * Discrete layout bucket for structural variants (column count, stack vs row).
 * Rebuilds whenever the live layout scale crosses thresholds.
 */
export function useFontScaleBucket(): FontScaleBucket {
  const scale = useFontScale();
  return useMemo(() => fontScaleBucket(scale), [scale]);
}

/**
 * Layout helpers that scale with Dynamic Type + app textScale + Bold Text.
 * Use for minHeights, gaps, and stage sizes so chrome shrinks/grows with text.
 */
export function useFontLayout() {
  const scale = useFontScale();
  const boldText = useBoldTextEnabled();
  const { textScale } = usePreferences();
  const bucket = useMemo(() => fontScaleBucket(scale), [scale]);

  return useMemo(() => {
    /** Scale a design-token size; optional clamp to keep hit targets ≥ min. */
    const s = (base: number, min = 0) => Math.max(min, Math.round(base * scale));
    return {
      scale,
      /** App Settings multiplier only (for design fontSize × user pref). */
      textScale,
      /** True when iOS Bold Text / Android high-contrast text is on. */
      boldText,
      bucket,
      s,
      /** Comfortable control min height (nav, chips, search). */
      controlMinH: s(48, 44),
      /** Dense control (segmented, small chips). */
      controlDenseMinH: s(38, 36),
      /** Primary CTA / command buttons. */
      commandMinH: s(54, 48),
      /** Vertical rhythm between chrome rows. */
      gap: s(8, 6),
    };
  }, [scale, textScale, boldText, bucket]);
}

export { fontScaleBucket };
export type { FontScaleBucket };
