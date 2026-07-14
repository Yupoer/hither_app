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
  type FontScaleBucket,
} from '../theme/typeScale';

function readRawFontScale(): number {
  const fromPixel = PixelRatio.getFontScale();
  if (Number.isFinite(fromPixel) && fromPixel > 0) return fromPixel;
  return 1;
}

/**
 * Live system font scale (already capped to GLOBAL_FONT_SCALE_CAP).
 *
 * Text reflows natively when Dynamic Type changes; layout must re-render too.
 * Sources (most → least preferred):
 * 1. useWindowDimensions().fontScale — updates with RN dimension events
 * 2. PixelRatio + AppState / Dimensions listeners — catch Settings return path
 */
export function useFontScale(): number {
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
 * Discrete layout bucket for structural variants (column count, stack vs row).
 * Rebuilds whenever the live (capped) scale crosses thresholds.
 */
export function useFontScaleBucket(): FontScaleBucket {
  const scale = useFontScale();
  return useMemo(() => fontScaleBucket(scale), [scale]);
}

/**
 * Layout helpers that scale with Dynamic Type (within the global cap).
 * Use for minHeights, gaps, and stage sizes so chrome shrinks/grows with text.
 */
export function useFontLayout() {
  const scale = useFontScale();
  const bucket = useMemo(() => fontScaleBucket(scale), [scale]);

  return useMemo(() => {
    /** Scale a design-token size; optional clamp to keep hit targets ≥ min. */
    const s = (base: number, min = 0) => Math.max(min, Math.round(base * scale));
    return {
      scale,
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
  }, [scale, bucket]);
}

export { fontScaleBucket };
export type { FontScaleBucket };
