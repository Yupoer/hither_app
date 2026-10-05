/** Default when no tools preference / session radius is available. */
export const ARRIVAL_RADIUS_M = 50;

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
 * Track departure separately while displaying the current distance ratio.
 */
export function gatedJourneyProgress(opts: {
  initialM: number;
  currentM: number;
  movedFromStartM: number;
  hasDepartedStart?: boolean;
  arrivalRadiusM?: number;
}): { progress: number; departed: boolean } {
  const departed =
    Boolean(opts.hasDepartedStart) ||
    hasDepartedProgressStart(opts.movedFromStartM, opts.initialM);
  // Distance presentation is independent of the departed/arrival bookkeeping.
  return {
    progress: journeyProgress(opts.initialM, opts.currentM, opts.arrivalRadiusM),
    departed,
  };
}

export function hasArrived(
  distanceM: number,
  radiusM: number = ARRIVAL_RADIUS_M,
): boolean {
  return Number.isFinite(distanceM) && distanceM <= radiusM;
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

export function journeyProgress(initialM: number, currentM: number, radiusM = 0): number {
  if (!Number.isFinite(initialM) || initialM < 0 || !Number.isFinite(currentM)) return 0;
  const radius = Number.isFinite(radiusM) ? Math.max(0, radiusM) : 0;
  if (initialM <= radius) return currentM <= radius ? 1 : 0;
  return clampDisplayProgress(1 - Math.max(currentM - radius, 0) / (initialM - radius));
}

/** Distance completion is independent of the accuracy-aware arrival receipt. */
export function clampDisplayProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

/** Remove the final radius segment using the ETA's own remaining-distance metric. */
export function etaToRadiusBoundary(etaToPinSeconds: number, remainingM: number, radiusM = ARRIVAL_RADIUS_M): number {
  if (!Number.isFinite(etaToPinSeconds) || !Number.isFinite(remainingM)) return 0;
  const radius = Number.isFinite(radiusM) ? Math.max(0, radiusM) : ARRIVAL_RADIUS_M;
  return remainingM <= 0 ? 0 : Math.max(0, etaToPinSeconds) * Math.max(remainingM - radius, 0) / remainingM;
}

/**
 * Sticky max so route detours / GPS jitter cannot reverse the milestone bar
 * for the same destination. Caller clears previousMax on destination change.
 */
export function monotonicProgress(
  raw: number | null | undefined,
  previousMax: number | null | undefined,
): number | null {
  if (raw == null || !Number.isFinite(raw)) {
    return previousMax != null && Number.isFinite(previousMax) ? previousMax : null;
  }
  if (previousMax == null || !Number.isFinite(previousMax)) return raw;
  return Math.max(previousMax, raw);
}

export interface PersonalDisplayProgressInput {
  initialM: number;
  currentM: number;
  movedFromStartM?: number;
  hasDepartedStart?: boolean;
  previousMax?: number | null;
  arrived?: boolean;
  arrivalRadiusM?: number;
  /** Compatibility metadata for callers that also track arrival milestones. */
  destinationId?: string | null;
  previousDestinationId?: string | null;
}

/**
 * One personal remaining bar for Live Activity, session bucket, and
 * background updates, measured to the configured radius endpoint.
 */
export function personalDisplayProgress(input: PersonalDisplayProgressInput): number {
  if (input.arrived) return 1;
  return journeyProgress(input.initialM, input.currentM, input.arrivalRadiusM ?? ARRIVAL_RADIUS_M);
}

/** Persist Live Activity buckets from the same personal-progress model. */
export function progressBucket20(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 20);
}
