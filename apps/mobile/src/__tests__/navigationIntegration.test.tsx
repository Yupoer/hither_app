import React from 'react';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import { canMarkDestinationArrival } from '../utils/arrivalMarking';
import { promoteDestinationWithinDay } from '../utils/tripDay';
import type { Destination, GroupState } from '../types';
import type { NavigationSession } from '../types/navigation';
import { enqueueLeaderGatheringStart } from '../state/coreDataSync';
import { deriveActiveGatheringFromGroupState } from '../utils/activeGatheringState';

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
jest.mock('../state/coreDataSync', () => ({
  readLocalJourneyProjection: jest.fn().mockResolvedValue(null),
  enqueueLeaderGatheringStart: jest.fn(),
  flushCoreOperationOutbox: jest.fn().mockResolvedValue(undefined),
  getCoreOperationOutbox: () => ({ getOperation: jest.fn().mockResolvedValue(null) }),
}));

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

const testStartFix = async () => ({ coordinates: { latitude: 24, longitude: 120 }, timestamp: Date.now(), accuracy: 5 });
describe('Navigation Session UI integration', () => {
  it('retries a failed local Start with a new durable command and keeps legacy RPC idle', async () => {
    const startSession = jest.fn();
    const createRequestId = jest.fn().mockReturnValueOnce('failed-request').mockReturnValueOnce('retry-request');
    const gathering = deriveActiveGatheringFromGroupState(state, 0);
    jest.mocked(enqueueLeaderGatheringStart)
      .mockRejectedValueOnce(new Error('local save failed'))
      .mockResolvedValueOnce({ local: gathering, base: gathering, operationId: 'retry-request' });
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: true,
        destinations: [localDestination, sharedDestination],
        selectedDestination: localDestination,
        fromCoords: undefined,
        acquireStartFix: testStartFix, arrivalRadiusM: 50,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: null,
        startSession,
        createRequestId,
      });
      return navigation.lifecycle;
    }

    act(() => { create(React.createElement(Harness)); });
    await act(async () => { await navigation?.startNavigation(sharedDestination, 1); });
    await act(async () => { await navigation?.startNavigation(sharedDestination, 1); });

    expect(createRequestId).toHaveBeenCalledTimes(2);
    expect(jest.mocked(enqueueLeaderGatheringStart).mock.calls.map((call) => call[1]?.operationId)).toEqual([
      'failed-request',
      'retry-request',
    ]);
    expect(startSession).not.toHaveBeenCalled();
    expect(navigation?.navTargetId).toBe(sharedDestination.id);
  });

  it('follows a promoted session once and resumes its local route after an explicit Start', () => {
    const centerOn = jest.fn();
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness({ navigationSession, terminalSession }: { navigationSession: NavigationSession | null; terminalSession?: NavigationSession }) {
      const destinations = navigationSession
        ? [{ ...sharedDestination, order: 0 }, { ...localDestination, order: 1 }]
        : [localDestination, sharedDestination];
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: false,
        destinations,
        selectedDestination: localDestination,
        fromCoords: undefined,
        acquireStartFix: testStartFix, arrivalRadiusM: 50,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: { centerOn } as never },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession,
        terminalSession,
      });
      return navigation.lifecycle;
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
    expect(centerOn).toHaveBeenCalledTimes(2);
    expect(centerOn).toHaveBeenNthCalledWith(1, localDestination.coordinates, { animated: false });
    expect(centerOn).toHaveBeenNthCalledWith(2, sharedDestination.coordinates, { animated: false });

    act(() => {
      renderer.update(React.createElement(Harness, { navigationSession: null, terminalSession: { ...session, status: 'cancelled' } }));
    });
    expect(navigation?.navTargetId).toBeNull();
    expect(navigation?.localTargetId).toBe(localDestination.id);
    act(() => { void navigation?.startNavigation(localDestination, 0); });
    expect(navigation?.navTargetId).toBe(localDestination.id);
  });

  it('after promote, solo leader can mark arrival on the selected later stop', () => {
    const first = {
      id: 'stop-1',
      title: 'First',
      coordinates: { latitude: 25.04, longitude: 121.5 },
      order: 0,
      day: 1,
    } as Destination;
    const second = {
      id: 'stop-2',
      title: 'Second',
      coordinates: { latitude: 25.05, longitude: 121.51 },
      order: 1,
      day: 1,
    } as Destination;
    const promoted = promoteDestinationWithinDay([first, second], second.id);
    const reordered = promoted.map((item) => {
      const base = item.id === first.id ? first : second;
      return { ...base, order: item.position, day: item.day };
    });
    const selected = reordered.find((d) => d.id === second.id)!;
    expect(
      canMarkDestinationArrival({
        destId: selected.id,
        destOrder: selected.order,
        scopedDestinations: reordered,
        myArrivedDestinationIds: new Set(),
      }),
    ).toBe(true);
  });
});
