import type { LayoutRectangle } from 'react-native';
import type { TourTargetId } from './constants';

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
