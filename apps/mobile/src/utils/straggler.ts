import type { Coordinates, MemberLocation } from '../types';
import { distanceMeters } from './geo';

export interface StragglerInput {
  members: MemberLocation[];
  /** The viewer's own coordinates; falls back to the flock centroid when absent. */
  target?: Coordinates;
  thresholdM: number;
}

export interface Straggler {
  userId: string;
  name: string;
  distanceM: number;
}

/**
 * Members who have fallen more than `thresholdM` behind the reference point
 * (the viewer's own position, or the flock's centroid when unknown) — i.e.
 * behind ME, not behind the gathering point. Solo members, subgroup members,
 * and members without a location fix don't count — and a lone remaining
 * member has nobody to straggle behind.
 */
export function findStragglers(input: StragglerInput): Straggler[] {
  const { members, target, thresholdM } = input;

  const eligible = members.filter(
    (m) => !m.solo && !m.subgroupId && m.coordinates != null,
  );
  if (eligible.length < 2) return [];

  const reference: Coordinates =
    target ??
    eligible.reduce(
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
