import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Dimensions,
  PixelRatio,
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
 * Layout scale = capped(system Dynamic Type) × app Settings textScale.
 * Use for minHeights, gaps, and chrome — not as Text fontSize when
 * allowFontScaling is also enabled (would double-apply system scale).
 */
export function useFontScale(): number {
  const system = useSystemFontScale();
  const { textScale } = usePreferences();
  return useMemo(
    () => layoutFontScale(system, textScale),
    [system, textScale],
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
 * Layout helpers that scale with Dynamic Type + app textScale.
 * Use for minHeights, gaps, and stage sizes so chrome shrinks/grows with text.
 */
export function useFontLayout() {
  const scale = useFontScale();
  const { textScale } = usePreferences();
  const bucket = useMemo(() => fontScaleBucket(scale), [scale]);

  return useMemo(() => {
    /** Scale a design-token size; optional clamp to keep hit targets ≥ min. */
    const s = (base: number, min = 0) => Math.max(min, Math.round(base * scale));
    return {
      scale,
      /** App Settings multiplier only (for design fontSize × user pref). */
      textScale,
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
  }, [scale, textScale, bucket]);
}

export { fontScaleBucket };
export type { FontScaleBucket };
