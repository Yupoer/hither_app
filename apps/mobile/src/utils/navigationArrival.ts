export type ArrivalStatus = 'enRoute' | 'arriving' | 'arrived';

export interface ArrivalState {
  status: ArrivalStatus;
  consecutiveFixes: number;
  progress: number;
  initialDistanceM: number;
  lastDistanceM: number | null;
}

export interface ArrivalSample {
  distanceM: number;
  /** Missing/unknown accuracy is allowed when already clearly inside radius. */
  accuracyM?: number | null;
}

export interface ArrivalDestination {
  radiusM: number;
}

export type ArrivalResult = ArrivalState;

/**
 * Two fixes only near the edge of the geofence (GPS jitter).
 * Clearly inside (≤ half radius, or ≤ radius with unknown/good accuracy) → 1 fix.
 */
const EDGE_CONFIRM_FIXES = 2;
const MAX_ACCURACY_M = 80;
const MAX_BACKWARD_PROGRESS = 0.03;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function createArrivalState(initialDistanceM: number): ArrivalState {
  return {
    status: 'enRoute',
    consecutiveFixes: 0,
    progress: 0,
    initialDistanceM: Math.max(0, initialDistanceM),
    lastDistanceM: null,
  };
}

/** Whether a fix is usable for geofence decisions. */
export function isUsableArrivalAccuracy(
  accuracyM: number | null | undefined,
): boolean {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return true;
  if (accuracyM < 0) return true;
  return accuracyM <= MAX_ACCURACY_M;
}

export function reduceArrival(
  previous: ArrivalState,
  sample: ArrivalSample,
  destination: ArrivalDestination,
): ArrivalResult {
  const distanceM = Math.max(0, sample.distanceM);
  const radiusM = Math.max(0, destination.radiusM);
  const rawProgress = previous.initialDistanceM > 0
    ? 1 - distanceM / previous.initialDistanceM
    : distanceM <= radiusM
      ? 1
      : 0;
  const progress = clamp(
    Math.max(rawProgress, previous.progress - MAX_BACKWARD_PROGRESS),
    0,
    1,
  );

  if (previous.status === 'arrived') {
    return { ...previous, progress: Math.max(progress, 1), lastDistanceM: distanceM };
  }

  const usable = isUsableArrivalAccuracy(sample.accuracyM);
  const inside = usable && distanceM <= radiusM;
  if (!inside) {
    return {
      ...previous,
      status: 'enRoute',
      consecutiveFixes: 0,
      progress,
      lastDistanceM: distanceM,
    };
  }

  // Clearly inside: half-radius, or full radius with usable accuracy → one fix.
  // Edge band (half…radius) with known accuracy still wants a second sample.
  const clearlyInside = distanceM <= radiusM * 0.5;
  const consecutiveFixes = previous.consecutiveFixes + 1;
  const needFixes = clearlyInside ? 1 : EDGE_CONFIRM_FIXES;
  const status: ArrivalStatus = consecutiveFixes >= needFixes
    ? 'arrived'
    : 'arriving';

  return {
    ...previous,
    status,
    consecutiveFixes,
    progress: status === 'arrived' ? Math.max(progress, 1) : progress,
    lastDistanceM: distanceM,
  };
}
