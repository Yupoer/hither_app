/**
 * Gathering card command-row layout (#148).
 *
 * Final order: [Start/End | Arrived] [Countdown] [Transport]
 * - Arrived + transport: fixed squares
 * - Countdown: 1.5× baseline width on normal screens (extra taken from nav)
 * - All hit targets ≥ 48pt; narrow screens shrink gaps first
 */

export const GATHER_CMD_MIN_HIT_PT = 48;
/** Arrived split-in duration (ms). Spec: 220–300ms. */
export const ARRIVED_SPLIT_MS = 260;
/** Reduce Motion fade instead of size-move. */
export const ARRIVED_FADE_MS = 160;
/** Normal-width countdown vs previous baseline. */
export const COUNTDOWN_WIDTH_FACTOR = 1.5;

export type GatherCommandLayoutInput = {
  /** Available width for the whole command row. */
  rowWidth: number;
  /** Gap between controls before narrow clamp. */
  baseGap: number;
  /** Fixed square size for transport / arrived (and nav min). */
  squareSize: number;
  /** Baseline countdown width before the 1.5× expansion. */
  countdownBaseWidth: number;
  showNav: boolean;
  showArrived: boolean;
  narrow: boolean;
};

export type GatherCommandLayout = {
  gap: number;
  squareSize: number;
  navWidth: number | null;
  countdownWidth: number;
  order: readonly ['nav', 'arrived', 'countdown', 'transport'];
};

/**
 * Pure width allocation. Extra countdown width is taken only from the nav slot.
 * Gaps shrink on narrow before any control drops below 48pt.
 */
export function layoutGatherCommandWidths(
  input: GatherCommandLayoutInput,
): GatherCommandLayout {
  const order = ['nav', 'arrived', 'countdown', 'transport'] as const;
  const squareSize = Math.max(GATHER_CMD_MIN_HIT_PT, input.squareSize);

  let gap = input.baseGap;
  if (input.narrow) {
    gap = Math.max(4, Math.min(gap, 6));
  }

  const fixedCount =
    (input.showNav ? 0 : 0) // nav is flexible
    + (input.showArrived ? 1 : 0)
    + 1 // transport always
    + 1; // countdown always
  // Count flex slots for gap: nav?(1) + arrived? + countdown + transport
  const slotCount =
    (input.showNav ? 1 : 0) + (input.showArrived ? 1 : 0) + 2;
  const gapsTotal = Math.max(0, slotCount - 1) * gap;

  const fixedSquares =
    (input.showArrived ? squareSize : 0) + squareSize; // transport

  const desiredCountdown = input.narrow
    ? Math.max(
        GATHER_CMD_MIN_HIT_PT,
        Math.min(
          input.countdownBaseWidth * COUNTDOWN_WIDTH_FACTOR,
          // On narrow: use largest that fits after min nav + squares + gaps
          Math.max(
            GATHER_CMD_MIN_HIT_PT,
            input.rowWidth
              - gapsTotal
              - fixedSquares
              - (input.showNav ? GATHER_CMD_MIN_HIT_PT : 0),
          ),
        ),
      )
    : Math.max(
        GATHER_CMD_MIN_HIT_PT,
        input.countdownBaseWidth * COUNTDOWN_WIDTH_FACTOR,
      );

  let countdownWidth = desiredCountdown;
  let navWidth: number | null = null;

  if (input.showNav) {
    const remaining =
      input.rowWidth - gapsTotal - fixedSquares - countdownWidth;
    navWidth = Math.max(GATHER_CMD_MIN_HIT_PT, remaining);
    // If row is too tight, shrink countdown after nav hits floor.
    const overflow =
      gapsTotal + fixedSquares + countdownWidth + navWidth - input.rowWidth;
    if (overflow > 0) {
      countdownWidth = Math.max(
        GATHER_CMD_MIN_HIT_PT,
        countdownWidth - overflow,
      );
      navWidth = Math.max(
        GATHER_CMD_MIN_HIT_PT,
        input.rowWidth - gapsTotal - fixedSquares - countdownWidth,
      );
    }
  } else {
    // No nav: countdown takes remaining after squares.
    countdownWidth = Math.max(
      GATHER_CMD_MIN_HIT_PT,
      input.rowWidth - gapsTotal - fixedSquares,
    );
  }

  // Silence unused in case of future fixedCount use.
  void fixedCount;

  return {
    gap,
    squareSize,
    navWidth,
    countdownWidth,
    order,
  };
}
