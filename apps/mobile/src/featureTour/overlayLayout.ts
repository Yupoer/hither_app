/**
 * Pure placement for the tour tooltip card relative to a highlight hole.
 * Uses measured card height so Dynamic Type cannot push the card off-screen.
 */

export interface OverlayHole {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const HOLE_PAD = 8;
/** Card-kind corner cap. Compact chips use a circular radius instead. */
export const HOLE_RADIUS = 16;

export type OverlayHoleKind = 'compact' | 'card';

const COMPACT_HOLE_TARGETS: ReadonlySet<string> = new Set([
  'externalMaps',
  'avatar',
  'settings',
  'arrivalProgress',
  'navCommand',
  'personalArrive',
  'transport',
  'meetTime',
]);

export function holeKindForTarget(target: string | null | undefined): OverlayHoleKind {
  if (target && COMPACT_HOLE_TARGETS.has(target)) return 'compact';
  return 'card';
}

export function paddedHole(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): OverlayHole {
  return {
    x: Math.max(0, rect.x - HOLE_PAD),
    y: Math.max(0, rect.y - HOLE_PAD),
    w: rect.width + HOLE_PAD * 2,
    h: rect.height + HOLE_PAD * 2,
  };
}

/** Highlight cutout and ring are axis-aligned rectangles — never rounded. */
export function holeRadius(
  _padded: { w: number; h: number },
  _kind: OverlayHoleKind,
): number {
  return 0;
}

/** Sheet tab strip wrap margin — keep in sync with MapScreen.sheetPaneToggleWrap. */
export const SHEET_PANE_TAB_WRAP_MARGIN_TOP = 10;
/** Trust measureInWindow when it is already this close to the live chrome. */
export const SHEET_TOUR_Y_SLOP_PX = 24;

const SHEET_TOUR_TARGETS: ReadonlySet<string> = new Set([
  'paneMembers',
  'paneRoute',
  'paneTools',
  'paneStore',
  'stageTwoPlacement',
]);

export function isSheetTourTarget(id: string | null | undefined): boolean {
  return Boolean(id && SHEET_TOUR_TARGETS.has(id));
}

/** Visual top of the Stage Two icon-tab row at the live sheet height. */
export function expectedSheetChromeTop(input: {
  windowHeight: number;
  sheetHeight: number;
  headerHeight: number;
  wrapMarginTop?: number;
  bottomOffset?: number;
}): number {
  const wrap = input.wrapMarginTop ?? SHEET_PANE_TAB_WRAP_MARGIN_TOP;
  const bottom = input.bottomOffset ?? 0;
  return input.windowHeight - input.sheetHeight - bottom + input.headerHeight + wrap;
}

/**
 * measureInWindow on sheet children still sees peek Yoga layout (Reanimated
 * height/bottom never enter Yoga). Snap Y to the live mid chrome when the
 * measured top is far from that expected line. Keep x/width/height.
 */
export function snapTourRectY<T extends { y: number }>(
  rect: T,
  expectedY: number,
  slop: number = SHEET_TOUR_Y_SLOP_PX,
): T {
  if (Math.abs(rect.y - expectedY) <= slop) return rect;
  return { ...rect, y: expectedY };
}

/** Intersect a measured rect with the window. Zero/negative size → null. */
export function clipRectToWindow(
  rect: { x: number; y: number; width: number; height: number } | null | undefined,
  winW: number,
  winH: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!rect) return null;
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(winW, rect.x + rect.width);
  const bottom = Math.min(winH, rect.y + rect.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export interface PlaceTourCardInput {
  hole: OverlayHole | null;
  windowWidth: number;
  windowHeight: number;
  insets: { top: number; bottom: number };
  /** Measured tooltip card height; null until first onLayout. */
  cardHeight: number | null;
  /** Fallback estimate before measure (default 160). */
  estimatedCardHeight?: number;
  /** Gap between hole edge and card (default 12). */
  gap?: number;
}

export interface PlaceTourCardResult {
  cardTop: number;
  /** Available safe-area height, retained for placement and diagnostics. */
  maxCardHeight: number;
  placeAbove: boolean;
}

export function placeTourCard(input: PlaceTourCardInput): PlaceTourCardResult {
  const gap = input.gap ?? 12;
  const estimated = input.estimatedCardHeight ?? 160;
  const cardH = input.cardHeight != null && input.cardHeight > 0 ? input.cardHeight : estimated;
  const topSafe = input.insets.top + 12;
  const bottomSafe = input.windowHeight - input.insets.bottom - 12;
  const usable = Math.max(120, bottomSafe - topSafe);

  if (!input.hole) {
    // Final get-started card: true vertical center of the usable viewport
    // (safe-area aware). Do not use a fixed 0.35 window-height bias.
    const usedH = Math.min(cardH, usable);
    const centered = topSafe + (usable - usedH) / 2;
    const top = Math.min(
      Math.max(topSafe, centered),
      bottomSafe - usedH,
    );
    return {
      cardTop: top,
      maxCardHeight: usable,
      placeAbove: false,
    };
  }

  const spaceAbove = input.hole.y - gap - topSafe;
  const spaceBelow = bottomSafe - (input.hole.y + input.hole.h + gap);
  const PIN_MIN = 160;
  const holeIsTopHeavy =
    input.hole.y < input.windowHeight * 0.25 || spaceAbove < PIN_MIN;

  const pinBottom = (): PlaceTourCardResult => {
    const maxH = Math.max(PIN_MIN, Math.min(usable, Math.max(cardH, PIN_MIN)));
    const usedH = Math.min(Math.max(cardH, PIN_MIN), usable);
    const top = Math.max(topSafe, bottomSafe - usedH);
    return { cardTop: top, maxCardHeight: maxH, placeAbove: false };
  };

  // Expanded gather card sits near the top and eats most of the screen.
  // Never park the tooltip in the sliver above it.
  if (holeIsTopHeavy) {
    if (spaceBelow >= PIN_MIN) {
      const maxH = spaceBelow;
      const top = input.hole.y + input.hole.h + gap;
      const usedH = Math.min(cardH, maxH);
      return {
        cardTop: Math.max(topSafe, Math.min(top, bottomSafe - usedH)),
        maxCardHeight: maxH,
        placeAbove: false,
      };
    }
    return pinBottom();
  }

  if (spaceAbove < PIN_MIN && spaceBelow < PIN_MIN) {
    return pinBottom();
  }

  if (spaceBelow >= spaceAbove) {
    const maxH = Math.max(100, spaceBelow);
    const top = input.hole.y + input.hole.h + gap;
    const usedH = Math.min(cardH, maxH);
    return {
      cardTop: Math.max(topSafe, Math.min(top, bottomSafe - usedH)),
      maxCardHeight: maxH,
      placeAbove: false,
    };
  }

  const maxH = Math.max(100, spaceAbove);
  const usedH = Math.min(cardH, maxH);
  const top = Math.max(topSafe, input.hole.y - gap - usedH);
  return { cardTop: top, maxCardHeight: maxH, placeAbove: true };
}
