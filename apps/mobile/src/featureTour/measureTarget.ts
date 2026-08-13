import type { LayoutRectangle } from 'react-native';
import type { TourStepDef, TourTargetId } from './constants';
import { clipRectToWindow } from './overlayLayout';

export type MeasureFn = (id: TourTargetId) => Promise<LayoutRectangle | null>;

/** Gathering-card control steps fall back to the card container when their control is unmeasured. */
export const STABLE_PARENT_BY_TARGET: Partial<Record<TourTargetId, TourTargetId>> = {
  arrivalProgress: 'gatherCard',
  externalMaps: 'gatherCard',
  navCommand: 'gatherCard',
  transport: 'gatherCard',
  personalArrive: 'gatherCard',
  meetTime: 'gatherCard',
};

export interface MeasureWithRetryOptions {
  measure: MeasureFn;
  target: TourTargetId;
  /** Max attempts including the first (default 5). */
  maxAttempts?: number;
  /** Delay between attempts in ms (default 80). */
  retryDelayMs?: number;
  /** Optional sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * When true, ignore the first non-zero rect until two consecutive measures
   * match (expanding card must not keep the collapsed height).
   */
  requireStable?: boolean;
}

const STABLE_EPSILON_PX = 1;

function rectsClose(a: LayoutRectangle, b: LayoutRectangle): boolean {
  return (
    Math.abs(a.x - b.x) <= STABLE_EPSILON_PX
    && Math.abs(a.y - b.y) <= STABLE_EPSILON_PX
    && Math.abs(a.width - b.width) <= STABLE_EPSILON_PX
    && Math.abs(a.height - b.height) <= STABLE_EPSILON_PX
  );
}

/**
 * Bounded measurement retry with stable-parent fallback.
 * Never silently returns null for a non-null target without trying the parent.
 */
export async function measureTargetWithRetry(
  opts: MeasureWithRetryOptions,
): Promise<LayoutRectangle | null> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const delay = opts.retryDelayMs ?? 80;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let last: LayoutRectangle | null = null;
  let prevStable: LayoutRectangle | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(delay);
    last = await opts.measure(opts.target);
    if (last && last.width > 0 && last.height > 0) {
      if (!opts.requireStable) return last;
      if (prevStable && rectsClose(prevStable, last)) return last;
      prevStable = last;
    }
  }

  const parent = STABLE_PARENT_BY_TARGET[opts.target];
  if (parent && parent !== opts.target) {
    const parentRect = await opts.measure(parent);
    if (parentRect && parentRect.width > 0 && parentRect.height > 0) {
      return parentRect;
    }
  }
  return last;
}

/**
 * Kept as a compatibility export for existing tests/callers.  Stage Two
 * correctness now comes from bounded target retries, not a fixed sleep.
 */
export const STAGE_TWO_SETTLE_MS = 0;

export function getWindowSize(): { width: number; height: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Dimensions } = require('react-native') as typeof import('react-native');
    const win = Dimensions?.get?.('window');
    if (win && win.width > 0 && win.height > 0) {
      return { width: win.width, height: win.height };
    }
  } catch {
    /* jest mocks often omit Dimensions */
  }
  return { width: 390, height: 844 };
}

/**
 * Measure the current step hole + optional Stage Two placement rect.
 * Stage Two retries until the sheet/pane target is measurable, clips to the
 * window, and falls back to the tab strip when the pane target is missing.
 */
export async function measureTourStepRects(opts: {
  measure: MeasureFn;
  step: Pick<TourStepDef, 'target' | 'expandCard' | 'openStageTwo'>;
  winW: number;
  winH: number;
  sleep?: (ms: number) => Promise<void>;
  requireStable?: boolean;
}): Promise<{
  targetRect: LayoutRectangle | null;
  placementRect: LayoutRectangle | null;
}> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!opts.step.target) {
    return { targetRect: null, placementRect: null };
  }

  const rect = await measureTargetWithRetry({
    measure: opts.measure,
    target: opts.step.target,
    maxAttempts: opts.step.openStageTwo ? 10 : opts.step.expandCard ? 8 : 5,
    retryDelayMs: 80,
    requireStable: opts.requireStable ?? Boolean(opts.step.expandCard),
    sleep,
  });

  let place: LayoutRectangle | null = null;
  if (opts.step.openStageTwo) {
    place = await measureTargetWithRetry({
      measure: opts.measure,
      target: 'stageTwoPlacement',
      maxAttempts: 5,
      retryDelayMs: 80,
      sleep,
    });
  }

  if (opts.step.openStageTwo) {
    const clipped = clipRectToWindow(rect, opts.winW, opts.winH);
    return {
      targetRect: clipped ?? place,
      placementRect: place,
    };
  }

  return { targetRect: rect, placementRect: place };
}
