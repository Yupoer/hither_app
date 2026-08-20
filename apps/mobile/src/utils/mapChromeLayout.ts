export type MapSafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type MapChromeLayout = {
  compassOffset: { x: number; y: number };
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
/** Compass sits just below the top card, not overlapping it. */
export const COMPASS_BELOW_TOP_CHROME = 8;

/** Same 10/14 inset the gathering-point carousel uses. */
export function gatherCardHorizontalInset(windowWidth: number): number {
  return windowWidth < 400 ? GATHER_CARD_INSET_NARROW : GATHER_CARD_INSET_WIDE;
}

/**
 * Keep native MapKit chrome anchored to the map surface, not to a sheet
 * detent. `topChrome` is the already-computed height occupied by the safe-area
 * aware top card/carousel. Horizontal alignment matches gather-card / peek
 * inset so Compass (trailing) and the Apple logo (leading) sit on that guide.
 */
export function mapKitChromeLayout({
  safeArea,
  topChrome,
  horizontalInset,
}: {
  safeArea: MapSafeAreaInsets;
  topChrome: number;
  horizontalInset: number;
}): MapChromeLayout {
  return {
    compassOffset: {
      x: horizontalInset,
      y: topChrome + COMPASS_BELOW_TOP_CHROME,
    },
    appleLogoInsets: {
      top: 0,
      right: 0,
      left: horizontalInset,
      bottom: Math.max(0, safeArea.bottom),
    },
  };
}
