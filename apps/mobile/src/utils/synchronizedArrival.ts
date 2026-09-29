/** A recovered target is evaluated immediately; cached or unknown GPS must not check in. */
export function canEvaluateSynchronizedArrival(input: {
  sampledAt: number | null;
  now: number;
  accuracyM: number | null | undefined;
  radiusM: number;
}): boolean {
  const { sampledAt, now, accuracyM, radiusM } = input;
  return sampledAt != null && Number.isFinite(sampledAt)
    && sampledAt <= now && now - sampledAt <= 15_000
    && accuracyM != null && Number.isFinite(accuracyM)
    && accuracyM >= 0 && Number.isFinite(radiusM) && radiusM > 0
    && accuracyM <= Math.min(radiusM, 80);
}

/** Retargeting the same destination must invalidate fix-level deduplication. */
export function synchronizedArrivalTargetKey(sessionId: string | null | undefined,
  destination: { id: string; coordinates: { latitude: number; longitude: number } }, radiusM: number): string {
  return `${sessionId ?? 'local'}:${destination.id}:${destination.coordinates.latitude}:${destination.coordinates.longitude}:${radiusM}`;
}
