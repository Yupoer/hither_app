export type LocationFreshness =
  | { unit: 'missing' | 'justNow' }
  | { unit: 'minutes' | 'hours'; value: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Metadata of the actual stored sample, rather than the viewer's mode. */
export interface LocationSampleMetadata {
  locationTrackingMode?: string | null;
  locationSource?: string | null;
  locationNavigationSessionId?: string | null;
}

export function locationFreshnessLimitMs(metadata: LocationSampleMetadata = {}): number {
  // A background task with no navigation session is the 150s presence owner.
  // Missing metadata and explicit refreshes retain the conservative 120s limit.
  return metadata.locationTrackingMode === 'passiveBackground'
    && metadata.locationSource === 'background_task'
    && metadata.locationNavigationSessionId === null ? 180_000 : 120_000;
}

export function isLocationSampleFresh(
  capturedAt: string | null | undefined,
  metadata: LocationSampleMetadata = {},
  nowMs = Date.now(),
): boolean {
  if (!capturedAt) return false;
  const ageMs = nowMs - Date.parse(capturedAt);
  return Number.isFinite(ageMs) && ageMs >= -120_000 && ageMs < locationFreshnessLimitMs(metadata);
}

export function locationFreshness(
  lastUpdated: string | undefined,
  nowMs: number,
): LocationFreshness {
  if (!lastUpdated) return { unit: 'missing' };

  const updatedMs = Date.parse(lastUpdated);
  if (!Number.isFinite(updatedMs)) return { unit: 'missing' };

  const ageMs = Math.max(0, nowMs - updatedMs);
  if (ageMs < MINUTE_MS) return { unit: 'justNow' };
  if (ageMs < HOUR_MS) return { unit: 'minutes', value: Math.floor(ageMs / MINUTE_MS) };
  return { unit: 'hours', value: Math.floor(ageMs / HOUR_MS) };
}

/**
 * Prefer the latest accepted self GPS sample for the viewer's own flock row
 * so a successful refresh never stays stuck on「尚無位置更新」when the blue-dot
 * / upload path already has a valid sample and remote lastUpdated is empty.
 */
export function resolveSelfAwareLastUpdated(input: {
  isSelf: boolean;
  remoteLastUpdated?: string | null;
  /** Wall-clock ms of last UI-accepted self sample (deviceCoordsAcceptedAtMs). */
  selfSampleAtMs?: number | null;
}): string | undefined {
  const remote = input.remoteLastUpdated?.trim() || undefined;
  if (
    !input.isSelf
    || input.selfSampleAtMs == null
    || !Number.isFinite(input.selfSampleAtMs)
  ) {
    return remote;
  }
  const selfIso = new Date(input.selfSampleAtMs).toISOString();
  if (!remote) return selfIso;
  const remoteMs = Date.parse(remote);
  if (!Number.isFinite(remoteMs) || input.selfSampleAtMs >= remoteMs) {
    return selfIso;
  }
  return remote;
}
