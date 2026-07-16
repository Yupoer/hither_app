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
  accuracyM: number;
}

export interface ArrivalDestination {
  radiusM: number;
}

export type ArrivalResult = ArrivalState;

const REQUIRED_FIXES = 2;
const MAX_ACCURACY_M = 50;
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

export function reduceArrival(
  previous: ArrivalState,
  sample: ArrivalSample,
  destination: ArrivalDestination,
): ArrivalResult {
  const distanceM = Math.max(0, sample.distanceM);
  const rawProgress = previous.initialDistanceM > 0
    ? 1 - distanceM / previous.initialDistanceM
    : distanceM <= destination.radiusM
      ? 1
      : 0;
  const progress = clamp(
    Math.max(rawProgress, previous.progress - MAX_BACKWARD_PROGRESS),
    0,
    1,
  );

  if (previous.status === 'arrived') {
    return { ...previous, progress, lastDistanceM: distanceM };
  }

  const accurate = Number.isFinite(sample.accuracyM) &&
    sample.accuracyM >= 0 &&
    sample.accuracyM <= MAX_ACCURACY_M;
  const inside = accurate && distanceM <= Math.max(0, destination.radiusM);
  const consecutiveFixes = inside ? previous.consecutiveFixes + 1 : 0;
  const status: ArrivalStatus = consecutiveFixes >= REQUIRED_FIXES
    ? 'arrived'
    : consecutiveFixes === 1
      ? 'arriving'
      : 'enRoute';

  return {
    ...previous,
    status,
    consecutiveFixes,
    progress,
    lastDistanceM: distanceM,
  };
}
