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

/**
 * Keep native MapKit chrome anchored to the map surface, not to a sheet
 * detent. `topChrome` is the already-computed height occupied by the safe-area
 * aware top card/carousel. A sheet can therefore cover the legal logo through
 * normal view clipping without moving its map-bottom baseline.
 */
export function mapKitChromeLayout({
  safeArea,
  topChrome,
}: {
  safeArea: MapSafeAreaInsets;
  topChrome: number;
}): MapChromeLayout {
  return {
    compassOffset: {
      x: Math.max(56, safeArea.right + 44),
      y: Math.max(56, safeArea.top + 16, topChrome + 16),
    },
    appleLogoInsets: {
      top: 0,
      right: 0,
      left: Math.max(16, safeArea.left + 12),
      bottom: Math.max(12, safeArea.bottom + 12),
    },
  };
}
