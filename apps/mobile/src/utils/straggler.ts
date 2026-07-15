import type { Coordinates, MemberLocation } from '../types';
import { distanceMeters } from './geo';

export interface StragglerInput {
  members: MemberLocation[];
  /**
   * Reference point for 1:N distance (product path: leader GPS).
   * Falls back to flock centroid only when absent (tests / tools).
   */
  target?: Coordinates;
  thresholdM: number;
  /**
   * Never flag this user (the leader). Distance to self is 0 when target is
   * their GPS, but excluding is explicit for centroid fallback cases.
   */
  leaderUserId?: string;
}

export interface Straggler {
  userId: string;
  name: string;
  distanceM: number;
}

/**
 * Members farther than `thresholdM` from the reference point.
 *
 * Product model: leader GPS → each main-team member (1:N). Solo, subgroup,
 * and members without coordinates are ignored. The leader is never listed.
 */
export function findStragglers(input: StragglerInput): Straggler[] {
  const { members, target, thresholdM, leaderUserId } = input;

  const eligible = members.filter(
    (m) =>
      !m.solo &&
      !m.subgroupId &&
      m.coordinates != null &&
      (leaderUserId == null || m.userId !== leaderUserId),
  );
  // Need a reference plus at least one other member in the flock overall.
  const flockWithCoords = members.filter(
    (m) => !m.solo && !m.subgroupId && m.coordinates != null,
  );
  if (eligible.length === 0 || flockWithCoords.length < 2) return [];

  const reference: Coordinates =
    target ??
    flockWithCoords.reduce(
      (acc, m, i) => {
        const c = m.coordinates as Coordinates;
        return {
          latitude: acc.latitude + (c.latitude - acc.latitude) / (i + 1),
          longitude: acc.longitude + (c.longitude - acc.longitude) / (i + 1),
        };
      },
      { latitude: 0, longitude: 0 },
    );

  return eligible
    .map((m) => ({
      userId: m.userId,
      name: m.name,
      distanceM: distanceMeters(reference, m.coordinates as Coordinates),
    }))
    .filter((s) => s.distanceM > thresholdM)
    .sort((a, b) => b.distanceM - a.distanceM);
}
