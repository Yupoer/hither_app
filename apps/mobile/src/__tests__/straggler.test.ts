import { findStragglers } from '../utils/straggler';
import type { MemberLocation } from '../types';

function member(overrides: Partial<MemberLocation>): MemberLocation {
  return {
    userId: 'u',
    name: 'name',
    role: 'follower',
    coordinates: { latitude: 25.0478, longitude: 121.517 },
    ...overrides,
  };
}

describe('findStragglers', () => {
  it('flags a member beyond the threshold from the target', () => {
    const leader = member({ userId: 'leader', name: 'Leader' });
    // ~555m north of the target (0.005 deg lat ~= 555m).
    const far = member({
      userId: 'far',
      name: 'Far',
      coordinates: { latitude: 25.0478 + 0.005, longitude: 121.517 },
    });
    const result = findStragglers({
      members: [leader, far],
      target: { latitude: 25.0478, longitude: 121.517 },
      thresholdM: 500,
    });
    expect(result.map((s) => s.userId)).toEqual(['far']);
  });

  it('does not flag a member within the threshold from the target', () => {
    const leader = member({ userId: 'leader' });
    const near = member({
      userId: 'near',
      coordinates: { latitude: 25.0478 + 0.0005, longitude: 121.517 },
    });
    const result = findStragglers({
      members: [leader, near],
      target: { latitude: 25.0478, longitude: 121.517 },
      thresholdM: 500,
    });
    expect(result).toEqual([]);
  });

  it('falls back to the flock centroid when no target is given', () => {
    // A cluster of 9 members keeps the centroid close to (25.0, 121.0) even
    // with one far-off member pulling on the average.
    const cluster = Array.from({ length: 9 }, (_, i) =>
      member({ userId: `cluster-${i}`, coordinates: { latitude: 25.0, longitude: 121.0 } }),
    );
    const far = member({
      userId: 'far',
      coordinates: { latitude: 25.02, longitude: 121.0 }, // ~2.2km from the cluster
    });
    const result = findStragglers({ members: [...cluster, far], thresholdM: 500 });
    expect(result.map((s) => s.userId)).toEqual(['far']);
  });

  it('excludes solo members, subgroup members, and members without coordinates', () => {
    const leader = member({ userId: 'leader' });
    const soloFar = member({
      userId: 'solo-far',
      solo: true,
      coordinates: { latitude: 25.0478 + 0.01, longitude: 121.517 },
    });
    const subgroupFar = member({
      userId: 'sub-far',
      subgroupId: 'sg1',
      coordinates: { latitude: 25.0478 + 0.01, longitude: 121.517 },
    });
    const noCoords = member({ userId: 'no-coords', coordinates: undefined });
    const far = member({
      userId: 'far',
      coordinates: { latitude: 25.0478 + 0.01, longitude: 121.517 },
    });
    const result = findStragglers({
      members: [leader, soloFar, subgroupFar, noCoords, far],
      target: { latitude: 25.0478, longitude: 121.517 },
      thresholdM: 500,
    });
    expect(result.map((s) => s.userId)).toEqual(['far']);
  });

  it('returns empty when fewer than 2 eligible members remain', () => {
    const onlyOne = member({ userId: 'solo-leader' });
    const result = findStragglers({
      members: [onlyOne],
      target: { latitude: 25.0478, longitude: 121.517 },
      thresholdM: 500,
    });
    expect(result).toEqual([]);
  });

  it('sorts stragglers by distance descending', () => {
    const leader = member({ userId: 'leader' });
    const mid = member({
      userId: 'mid',
      coordinates: { latitude: 25.0478 + 0.006, longitude: 121.517 },
    });
    const farthest = member({
      userId: 'farthest',
      coordinates: { latitude: 25.0478 + 0.02, longitude: 121.517 },
    });
    const result = findStragglers({
      members: [leader, mid, farthest],
      target: { latitude: 25.0478, longitude: 121.517 },
      thresholdM: 500,
    });
    expect(result.map((s) => s.userId)).toEqual(['farthest', 'mid']);
    expect(result[0].distanceM).toBeGreaterThan(result[1].distanceM);
  });
});
