export const ARRIVAL_RADIUS_M = 30;

/** Reject cold/poor fixes when anchoring journey baseline (metres). */
export const ANCHOR_MAX_ACCURACY_M = 50;

/**
 * How far the user must walk from the journey start pin before progress
 * leaves 0%. Scales with trip length so short legs are not stuck, while
 * long legs still ignore typical GPS jitter (~10–15m).
 *
 * - Target ≈ 10% of initial distance
 * - Cap 40m on long trips
 * - Never more than 25% of initial (short-trip safety)
 * - Absolute 12m floor only when the trip is long enough that 12m ≤ 25%
 */
export function progressStartRadiusM(initialDistanceM: number): number {
  if (!Number.isFinite(initialDistanceM) || initialDistanceM <= 0) return 0;
  const MAX_M = 40;
  const RATIO = 0.1;
  const MAX_FRACTION = 0.25;
  const ABS_FLOOR_M = 12;
  const fractionCap = initialDistanceM * MAX_FRACTION;
  const ratioTarget = initialDistanceM * RATIO;
  const floor = fractionCap >= ABS_FLOOR_M ? ABS_FLOOR_M : 0;
  return Math.min(MAX_M, fractionCap, Math.max(floor, ratioTarget));
}

export function hasDepartedProgressStart(
  movedFromStartM: number,
  initialDistanceM: number,
): boolean {
  if (!Number.isFinite(movedFromStartM) || movedFromStartM < 0) return false;
  return movedFromStartM >= progressStartRadiusM(initialDistanceM);
}

export type DistanceSource = 'route' | 'fallback';

/**
 * Keep current distance on the same metric as the locked initial.
 * Route-anchored journeys must not silently fall back to straight-line
 * (which is almost always shorter → fake progress).
 */
export function sameMetricDistance(
  source: DistanceSource,
  routeM: number | undefined,
  straightM: number | undefined,
  lastRouteM?: number,
): number | undefined {
  if (source === 'route') {
    if (routeM != null && Number.isFinite(routeM) && routeM >= 0) return routeM;
    if (lastRouteM != null && Number.isFinite(lastRouteM) && lastRouteM >= 0) {
      return lastRouteM;
    }
    return undefined;
  }
  if (straightM != null && Number.isFinite(straightM) && straightM >= 0) {
    return straightM;
  }
  return undefined;
}

/**
 * Only anchor personal progress baseline from a real device GPS fix.
 * Never use peer/stale member pins — that alone caused large fake jumps.
 * Accuracy is soft: unknown accuracy is allowed; known-poor fixes are rejected
 * so a later better fix can become the start pin.
 */
export function shouldAnchorInitial(opts: {
  hasDeviceGps: boolean;
  accuracyM?: number | null;
}): boolean {
  if (!opts.hasDeviceGps) return false;
  const acc = opts.accuracyM;
  if (acc == null || !Number.isFinite(acc)) return true;
  return acc <= ANCHOR_MAX_ACCURACY_M;
}

/**
 * Progress stays 0 until the user has left the start radius (or already
 * departed earlier — sticky). After that, classic remaining-distance ratio.
 */
export function gatedJourneyProgress(opts: {
  initialM: number;
  currentM: number;
  movedFromStartM: number;
  hasDepartedStart?: boolean;
}): { progress: number; departed: boolean } {
  const departed =
    Boolean(opts.hasDepartedStart) ||
    hasDepartedProgressStart(opts.movedFromStartM, opts.initialM);
  if (!departed) return { progress: 0, departed: false };
  return {
    progress: journeyProgress(opts.initialM, opts.currentM),
    departed: true,
  };
}

export function hasArrived(distanceM: number): boolean {
  return Number.isFinite(distanceM) && distanceM <= ARRIVAL_RADIUS_M;
}

export function initialJourneyDistance(
  routeDistanceM: number | undefined,
  straightLineDistanceM: number | undefined,
): number | undefined {
  if (routeDistanceM != null && Number.isFinite(routeDistanceM) && routeDistanceM > 0) {
    return routeDistanceM;
  }
  if (
    straightLineDistanceM != null &&
    Number.isFinite(straightLineDistanceM) &&
    straightLineDistanceM > 0
  ) {
    return straightLineDistanceM;
  }
  return undefined;
}

export function journeyProgress(initialM: number, currentM: number): number {
  if (!Number.isFinite(initialM) || initialM <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - currentM / initialM));
}
