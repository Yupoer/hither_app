import type { LocationSample } from '../../native/location';
import { walkingEtaSeconds, type TravelMode } from '../../utils/geo';

type MotionMode = Exclude<TravelMode, 'transit'>;

export interface MotionReport {
  userId: string;
  mode: MotionMode;
}

export function majorityMotionMode(memberCount: number, reports: readonly MotionReport[]): MotionMode | null {
  const latestReports = new Map(reports.map(({ userId, mode }) => [userId, mode]));
  const votes: Record<MotionMode, number> = { walk: 0, bicycle: 0, drive: 0 };
  for (const mode of latestReports.values()) {
    votes[mode] += 1;
    if (memberCount > 0 && votes[mode] > memberCount / 2) return mode;
  }
  return null;
}

export function needsTransitETA({ distanceM, walkETA, remainingSeconds }: {
  distanceM: number;
  walkETA?: number | null;
  remainingSeconds?: number;
}): boolean {
  const missesMeeting = remainingSeconds != null && (walkETA ?? walkingEtaSeconds(distanceM)) > remainingSeconds;
  return missesMeeting || (distanceM > 1_000 && distanceM <= 15_000);
}

export function resolveAutomaticTravelMode({ override, majority, distanceM, walkETA, remainingSeconds, transitAvailable }: {
  override: TravelMode | null;
  majority: MotionMode | null;
  distanceM: number | null;
  walkETA?: number | null;
  remainingSeconds?: number;
  transitAvailable: boolean;
}): TravelMode {
  if (override) return override;
  if (majority) return majority;
  if (distanceM == null) return 'walk';
  if (needsTransitETA({ distanceM, walkETA, remainingSeconds })) return transitAvailable ? 'transit' : 'drive';
  return distanceM <= 1_000 ? 'walk' : 'drive';
}

export interface TravelOverride {
  lane: string;
  sessionId: string | null;
  mode: TravelMode;
}

export function reconcileTravelOverride(
  override: TravelOverride | null,
  { lane, activeJourneyId }: { lane: string | null; activeJourneyId: string | null | undefined },
): TravelOverride | null {
  if (!override || override.lane !== lane) return null;
  if (activeJourneyId === undefined || override.sessionId === activeJourneyId) return override;
  return !override.sessionId && activeJourneyId ? { ...override, sessionId: activeJourneyId } : null;
}

export function d6TravelOrigin(sample: Pick<LocationSample, 'coordinates' | 'timestamp'> | null, now: number) {
  if (!sample || !Number.isFinite(sample.timestamp)) return undefined;
  const age = now - sample.timestamp;
  return age >= -2000 && age < 60_000 ? sample.coordinates : undefined;
}
