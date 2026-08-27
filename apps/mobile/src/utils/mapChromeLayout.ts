export type MapSafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type MapChromeLayout = {
  compassOffset: { x: number; y: number };
  compassVisible?: boolean;
  appleLogoInsets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

/** Gather-card / peek horizontal inset on narrow phones (iPhone mini / 15). */
export const GATHER_CARD_INSET_NARROW = 10;
/** Gather-card / peek horizontal inset on default widths. */
export const GATHER_CARD_INSET_WIDE = 14;
/** Legacy top-card gap used when callers do not provide viewport geometry. */
export const COMPASS_BELOW_TOP_CHROME = 8;
export const COMPASS_ABOVE_LOCATE_GAP = 8;
export const MAP_RECENTER_WIDTH = 50;
export const MAP_RECENTER_HEIGHT = 96;
export const MAP_COMPASS_SIZE = 32;
/** The compass and 50pt recenter capsule share a centerline. */
export const COMPASS_HORIZONTAL_CENTER_ADJUSTMENT =
  (MAP_RECENTER_WIDTH - MAP_COMPASS_SIZE) / 2;

export type MapChromeStage = 'peek' | 'stage1' | 'stage2' | 'full';

/** Same 10/14 inset the gathering-point carousel uses. */
export function gatherCardHorizontalInset(windowWidth: number): number {
  return windowWidth < 400 ? GATHER_CARD_INSET_NARROW : GATHER_CARD_INSET_WIDE;
}

/**
 * Keep native MapKit chrome anchored to the map surface, not to a sheet
 * detent. `topChrome` is the already-computed height occupied by the safe-area
 * aware top card/carousel. Compass uses the same right inset as the recenter
 * capsule, plus the half-width delta needed to align both control centers.
 */
export function mapKitChromeLayout({
  safeArea,
  topChrome,
  horizontalInset,
  windowHeight,
  bottomChrome = 0,
  stage = 'peek',
}: {
  safeArea: MapSafeAreaInsets;
  topChrome: number;
  horizontalInset: number;
  /** Map viewport height; optional preserves old callers and tests. */
  windowHeight?: number;
  /** Settled bottom inset occupied by the map recenter capsule. */
  bottomChrome?: number;
  stage?: MapChromeStage;
}): MapChromeLayout {
  const compassVisible = stage === 'peek' || stage === 'stage1';
  const compassY = windowHeight != null && windowHeight > 0
    ? Math.max(
      safeArea.top,
      windowHeight - bottomChrome - MAP_RECENTER_HEIGHT - COMPASS_ABOVE_LOCATE_GAP - MAP_COMPASS_SIZE,
    )
    : topChrome + COMPASS_BELOW_TOP_CHROME;
  return {
    compassOffset: {
      x: horizontalInset + COMPASS_HORIZONTAL_CENTER_ADJUSTMENT,
      y: compassY,
    },
    compassVisible,
    appleLogoInsets: {
      top: 0,
      right: 0,
      left: horizontalInset,
      bottom: Math.max(0, safeArea.bottom),
    },
  };
}
