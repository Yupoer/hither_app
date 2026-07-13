export const ARRIVAL_RADIUS_M = 30;

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
