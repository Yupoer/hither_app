import type { GroupState } from '../types';
import {
  mergeRemoteGroupStatePreservingOwnLocation,
  SYNC_AUTHORITY,
} from '../utils/syncAuthority';

function state(overrides: Partial<GroupState> = {}): GroupState {
  return {
    group: {
      id: 'g1',
      name: 'Trip',
      inviteCode: 'ABC',
      createdBy: 'leader',
      journeyStatus: 'paused',
      stragglerAlerts: false,
      stragglerThresholdM: 200,
      ...overrides.group,
    },
    members: overrides.members ?? [],
    destinations: overrides.destinations ?? [],
    subgroups: overrides.subgroups ?? [],
    nextDestination: overrides.nextDestination,
  } as GroupState;
}

describe('syncAuthority', () => {
  it('documents the requested source precedence', () => {
    expect(SYNC_AUTHORITY.ownLocation[0]).toBe('local');
    expect(SYNC_AUTHORITY.peerLocation[0]).toBe('server');
    expect(SYNC_AUTHORITY.leaderGathering[0]).toBe('leader_local');
    expect(SYNC_AUTHORITY.gatheringRequest[0]).toBe('member_local');
    expect(SYNC_AUTHORITY.offlineProgress[0]).toBe('own_local_location');
  });

  it('preserves complete local itinerary during a leader sync gap', () => {
    const previous = state({
      group: { journeyStatus: 'going', activeDestinationId: 'a' } as GroupState['group'],
      destinations: [{ id: 'a', title: 'A' } as GroupState['destinations'][number]],
      nextDestination: { id: 'a', title: 'A' } as GroupState['nextDestination'],
    });
    const remote = state({
      group: { journeyStatus: 'paused', activeDestinationId: undefined } as GroupState['group'],
      destinations: [],
      nextDestination: undefined,
    });
    const merged = mergeRemoteGroupStatePreservingOwnLocation(
      previous,
      remote,
      null,
      { preserveLocalGathering: true },
    );
    expect(merged.destinations).toHaveLength(1);
    expect(merged.group.journeyStatus).toBe('going');
    expect(merged.group.activeDestinationId).toBe('a');
  });

  it('keeps own local GPS while accepting remote peer updates', () => {
    const previous = state({
      members: [
        {
          userId: 'me', name: 'Me', role: 'leader', status: 'active',
          coordinates: { latitude: 25.1, longitude: 121.5 },
          lastUpdated: '2026-07-26T10:00:00.000Z',
        },
        {
          userId: 'peer', name: 'Peer', role: 'follower', status: 'active',
          coordinates: { latitude: 25.2, longitude: 121.6 },
          lastUpdated: '2026-07-26T10:00:00.000Z',
        },
      ],
    });
    const remote = state({
      members: [
        {
          userId: 'me', name: 'Me', role: 'leader', status: 'active',
          coordinates: { latitude: 25.0, longitude: 121.4 },
          lastUpdated: '2026-07-26T09:00:00.000Z',
        },
        {
          userId: 'peer', name: 'Peer', role: 'follower', status: 'active',
          coordinates: { latitude: 25.3, longitude: 121.7 },
          lastUpdated: '2026-07-26T10:01:00.000Z',
        },
      ],
    });

    const merged = mergeRemoteGroupStatePreservingOwnLocation(previous, remote, 'me');
    expect(merged.members[0]?.coordinates).toEqual({ latitude: 25.1, longitude: 121.5 });
    expect(merged.members[0]?.lastUpdated).toBe('2026-07-26T10:00:00.000Z');
    expect(merged.members[1]?.coordinates).toEqual({ latitude: 25.3, longitude: 121.7 });
  });
});
