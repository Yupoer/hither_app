import type { Coordinates } from '../types';
import { distanceMeters } from './geo';

export interface MemberMotionSample { coordinates: Coordinates; sampledAt: number }

/** Display only. Late/implausible fixes never become an invented journey. */
export function memberMotionDuration(previous: MemberMotionSample | null, next: MemberMotionSample,
  now: number, animate: boolean): number {
  if (!animate || !previous || !Number.isFinite(next.sampledAt) || !Number.isFinite(previous.sampledAt)) return 0;
  const interval = next.sampledAt - previous.sampledAt;
  if (interval <= 0 || interval > 90_000 || now - next.sampledAt > 90_000 || next.sampledAt > now + 5_000) return 0;
  if (Math.abs(next.coordinates.longitude - previous.coordinates.longitude) > 180) return 0;
  const distance = distanceMeters(previous.coordinates, next.coordinates);
  if (distance < 1 || distance > Math.max(250, interval / 1000 * 80)) return 0;
  return Math.min(10_000, Math.max(500, interval));
}
