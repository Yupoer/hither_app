import {
  applyMemberLocationPatches,
  locationPatchFromRealtimePayload,
  mergeLocationPatches,
} from '../utils/groupStatePatches';
import type { GroupState } from '../types';

const baseState = {
  group: { id: 'g1', name: 'Trip', inviteCode: 'ABC' },
  members: [
    {
      userId: 'me',
      name: 'Me',
      role: 'leader',
      status: 'active',
      coordinates: { latitude: 25.0, longitude: 121.0 },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
    {
      userId: 'peer',
      name: 'Peer',
      role: 'follower',
      status: 'active',
      coordinates: { latitude: 25.1, longitude: 121.1 },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
  ],
  destinations: [],
  subgroups: [],
  nextDestination: undefined,
} as unknown as GroupState;

describe('locationPatchFromRealtimePayload', () => {
  it('parses a valid upsert row', () => {
    expect(
      locationPatchFromRealtimePayload({
        eventType: 'UPDATE',
        new: {
          user_id: 'peer',
          latitude: 25.2,
          longitude: 121.2,
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      }),
    ).toEqual({
      userId: 'peer',
      coordinates: { latitude: 25.2, longitude: 121.2 },
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('requests full reload on delete', () => {
    expect(
      locationPatchFromRealtimePayload({
        eventType: 'DELETE',
        old: { user_id: 'peer' },
        new: null,
      }),
    ).toBe('full-reload');
  });
});

describe('applyMemberLocationPatches', () => {
  it('keeps capture freshness separate from upload ordering for delayed positions', () => {
    const first = applyMemberLocationPatches(baseState, [{
      userId: 'peer', coordinates: { latitude: 25.2, longitude: 121.2 },
      capturedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    }], 'me')!;
    expect(first.members[1]).toMatchObject({
      capturedAt: '2026-01-02T00:00:00.000Z',
      uploadedAt: '2026-01-03T00:00:00.000Z',
      lastUpdated: '2026-01-02T00:00:00.000Z',
      locationAvailability: 'stale',
    });
    // A reordered realtime receipt cannot win merely because lastUpdated is
    // the older GPS capture time rather than the last server receipt.
    expect(applyMemberLocationPatches(first, [{
      userId: 'peer', coordinates: { latitude: 26, longitude: 122 },
      capturedAt: '2026-01-02T01:00:00.000Z',
      updatedAt: '2026-01-02T02:00:00.000Z',
    }], 'me')).toBe(first);
  });

  it('patches peer coordinates without network', () => {
    const next = applyMemberLocationPatches(
      baseState,
      [
        {
          userId: 'peer',
          coordinates: { latitude: 25.25, longitude: 121.25 },
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
      ],
      'me',
    );
    expect(next).not.toBeNull();
    expect(next!.members[1].coordinates).toEqual({
      latitude: 25.25,
      longitude: 121.25,
    });
    expect(next!.members[0]).toBe(baseState.members[0]);
  });

  it('skips own user id', () => {
    const next = applyMemberLocationPatches(
      baseState,
      [
        {
          userId: 'me',
          coordinates: { latitude: 99, longitude: 99 },
          updatedAt: 'x',
        },
      ],
      'me',
    );
    expect(next).toBe(baseState);
  });

  it('returns null for unknown members so caller can full-reload', () => {
    expect(
      applyMemberLocationPatches(
        baseState,
        [
          {
            userId: 'stranger',
            coordinates: { latitude: 1, longitude: 2 },
            updatedAt: 'x',
          },
        ],
        'me',
      ),
    ).toBeNull();
  });

  it('merges multiple patches by userId', () => {
    const map = new Map();
    mergeLocationPatches(map, {
      userId: 'peer',
      coordinates: { latitude: 1, longitude: 1 },
      updatedAt: 'a',
    });
    mergeLocationPatches(map, {
      userId: 'peer',
      coordinates: { latitude: 2, longitude: 2 },
      updatedAt: 'b',
    });
    expect(map.get('peer')?.coordinates.latitude).toBe(2);
  });
});
