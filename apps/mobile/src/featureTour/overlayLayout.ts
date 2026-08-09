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
