import React from 'react';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import type { Destination, GroupState } from '../types';
import type { NavigationSession } from '../types/navigation';

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (element: React.ReactElement) => void;
  };
};

jest.mock('../native', () => ({
  notifications: { scheduleLocalNotification: jest.fn() },
}));
jest.mock('../api/client', () => ({
  reorderDestinations: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'request-generated') }));

const localDestination = {
  id: 'local-destination',
  title: 'Local',
  coordinates: { latitude: 25.04, longitude: 121.5 },
  order: 0,
  day: 1,
} as Destination;
const sharedDestination = {
  ...localDestination,
  id: 'shared-destination',
  title: 'Shared',
  coordinates: { latitude: 25.05, longitude: 121.51 },
} as Destination;
const state = {
  group: { journeyStatus: 'paused' },
  members: [],
  destinations: [localDestination, sharedDestination],
  subgroups: [],
} as unknown as GroupState;
const session = {
  id: 'session-1',
  groupId: 'group-1',
  destinationId: sharedDestination.id,
  destination: {
    name: sharedDestination.title,
    coordinates: sharedDestination.coordinates,
    arrivalRadiusMeters: 50,
  },
  startedBy: 'leader-1',
  requestId: 'request-1',
  startedAt: new Date(0).toISOString(),
  expiresAt: new Date(60_000).toISOString(),
  status: 'active',
  version: 1,
} satisfies NavigationSession;

describe('Navigation Session UI integration', () => {
  it('reuses the leader request UUID after failure until start succeeds', async () => {
    const startSession = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(session);
    const createRequestId = jest.fn(() => 'stable-request');
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: true,
        destinations: [localDestination, sharedDestination],
        selectedDestination: localDestination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: null,
        startSession,
        createRequestId,
      });
      return null;
    }

    act(() => { create(React.createElement(Harness)); });
    await act(async () => { await navigation?.startNavigation(sharedDestination, 1); });
    await act(async () => { await navigation?.startNavigation(sharedDestination, 1); });

    expect(createRequestId).toHaveBeenCalledTimes(1);
    expect(startSession.mock.calls.map((call) => call[1])).toEqual([
      'stable-request',
      'stable-request',
    ]);
  });

  it('centres a follower once and restores its independent local route after terminal session', () => {
    const centerOn = jest.fn();
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness({ navigationSession }: { navigationSession: NavigationSession | null }) {
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: false,
        destinations: [localDestination, sharedDestination],
        selectedDestination: localDestination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: { centerOn } as never },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession,
      });
      return null;
    }

    let renderer: { update: (element: React.ReactElement) => void };
    act(() => {
      renderer = create(React.createElement(Harness, { navigationSession: null }));
    });
    act(() => { navigation?.startLocalRoutePlan(localDestination, 0); });
    expect(navigation?.navTargetId).toBe(localDestination.id);

    act(() => {
      renderer.update(React.createElement(Harness, { navigationSession: session }));
    });
    act(() => {
      renderer.update(React.createElement(Harness, { navigationSession: session }));
    });
    expect(navigation?.navTargetId).toBe(sharedDestination.id);
    expect(centerOn).toHaveBeenCalledTimes(2); // local selection + first shared session only

    act(() => {
      renderer.update(React.createElement(Harness, { navigationSession: null }));
    });
    expect(navigation?.navTargetId).toBe(localDestination.id);
  });
});
