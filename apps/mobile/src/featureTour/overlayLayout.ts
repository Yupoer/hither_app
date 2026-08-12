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

/** Shared radius for the dim cutout corners and the white ring. */
export function holeRadius(
  padded: { w: number; h: number },
  kind: OverlayHoleKind,
): number {
  const halfMin = Math.min(padded.w, padded.h) / 2;
  if (kind === 'compact') return halfMin;
  return Math.min(HOLE_RADIUS, halfMin);
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
  /** Max height the card may occupy (for ScrollView constraint). */
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

  const placeAbove = input.hole.y + input.hole.h > input.windowHeight * 0.55;
  const spaceAbove = input.hole.y - gap - topSafe;
  const spaceBelow = bottomSafe - (input.hole.y + input.hole.h + gap);

  // Huge hole: no usable band above or below — ignore the hole and pin
  // the card into the safe viewport (prefer bottom; top if bottom is worse).
  const PIN_MIN = 140;
  if (spaceAbove < PIN_MIN && spaceBelow < PIN_MIN) {
    const maxH = Math.max(PIN_MIN, usable);
    const usedH = Math.min(cardH, maxH);
    const pinToTop = spaceBelow < spaceAbove;
    const top = pinToTop ? topSafe : Math.max(topSafe, bottomSafe - usedH);
    return {
      cardTop: Math.min(top, Math.max(topSafe, bottomSafe - Math.min(usedH, usable))),
      maxCardHeight: maxH,
      placeAbove: pinToTop,
    };
  }

  if (placeAbove) {
    const maxH = Math.max(100, spaceAbove);
    const usedH = Math.min(cardH, maxH);
    const top = Math.max(topSafe, input.hole.y - gap - usedH);
    return { cardTop: top, maxCardHeight: maxH, placeAbove: true };
  }

  const maxH = Math.max(100, spaceBelow);
  const top = Math.min(
    input.hole.y + input.hole.h + gap,
    bottomSafe - Math.min(cardH, maxH),
  );
  return {
    cardTop: Math.max(topSafe, top),
    maxCardHeight: maxH,
    placeAbove: false,
  };
}
