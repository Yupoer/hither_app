import React from 'react';
import { deleteDestination, reorderDestinations } from '../api/client';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import type { Destination, GroupState } from '../types';
import type { NavigationSession } from '../types/navigation';

// react-test-renderer is installed but this project does not ship its typings.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
  create: (element: React.ReactElement) => {
    update: (nextElement: React.ReactElement) => void;
  };
};

jest.mock('../native', () => ({
  notifications: {
    scheduleLocalNotification: jest.fn(),
  },
}));

jest.mock('../api/client', () => ({
  reorderDestinations: jest.fn(),
  recordVisitedWaypoint: jest.fn(),
  deleteDestination: jest.fn(),
}));

const destination = {
  id: 'destination-1',
  title: '集合點',
  coordinates: { latitude: 25.0478, longitude: 121.517 },
  order: 0,
  day: 1,
} as Destination;

const pausedState = {
  group: { journeyStatus: 'paused' },
  members: [],
  destinations: [destination],
  subgroups: [],
  nextDestination: destination,
} as unknown as GroupState;

describe('useJourneyNavigation', () => {
  it('member joins shared flock nav without tapping 路徑 when session is active', () => {
    const activeSession = {
      id: 'session-member',
      status: 'active',
      destinationId: destination.id,
      destination: {
        name: destination.title,
        coordinates: destination.coordinates,
        arrivalRadiusMeters: 50,
      },
    } as NavigationSession;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness() {
      navigation = useJourneyNavigation({
        state: pausedState,
        groupId: 'group-1',
        isLeader: false,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: activeSession,
      });
      return null;
    }
    act(() => {
      create(React.createElement(Harness));
    });
    expect(navigation?.sharedTargetId).toBe(destination.id);
    expect(navigation?.journeyActive).toBe(true);
    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.localTargetId).toBeNull();
  });

  it('member synthesizes navTarget from session when stop is not in carousel list', () => {
    const activeSession = {
      id: 'session-past-day',
      status: 'active',
      destinationId: 'hidden-stop',
      destination: {
        name: '昨日站',
        coordinates: { latitude: 25.0, longitude: 121.5 },
        arrivalRadiusMeters: 300,
      },
    } as NavigationSession;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness() {
      navigation = useJourneyNavigation({
        state: pausedState,
        groupId: 'group-1',
        isLeader: false,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: activeSession,
      });
      return null;
    }
    act(() => {
      create(React.createElement(Harness));
    });
    expect(navigation?.journeyActive).toBe(true);
    expect(navigation?.navTarget?.id).toBe('hidden-stop');
    expect(navigation?.navTarget?.title).toBe('昨日站');
  });

  it('keeps navigation active when refresh still returns the old paused snapshot', async () => {
    const refresh = jest.fn().mockResolvedValue(true);
    const startSession = jest.fn().mockResolvedValue({
      id: 'session-1',
      status: 'active',
    } as NavigationSession);
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness({ state }: { state: GroupState }) {
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh,
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        startSession,
        createRequestId: () => 'request-1',
      });
      return null;
    }

    let renderer: { update: (nextElement: React.ReactElement) => void };
    act(() => {
      renderer = create(React.createElement(Harness, { state: pausedState }));
    });

    await act(async () => {
      await navigation?.startNavigation(destination, 0);
    });

    // Simulate the immediate post-request fetch returning the pre-update row.
    act(() => {
      renderer.update(React.createElement(Harness, { state: pausedState }));
    });

    expect(navigation?.journeyStatus).toBe('going');
    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.journeyActive).toBe(true);
    expect(startSession).toHaveBeenCalledWith(destination.id, 'request-1');
  });

  it('promotes the later stop then starts the session in that order', async () => {
    const later = { ...destination, id: 'destination-2', order: 1 };
    const startSession = jest.fn().mockResolvedValue({
      id: 'session-2',
      status: 'active',
      destinationId: later.id,
    } as NavigationSession);
    const reorderForNavigation = jest.fn().mockResolvedValue(true);
    const setSelectedIndex = jest.fn();
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness() {
      navigation = useJourneyNavigation({
        state: pausedState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination, later],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex,
        startSession,
        createRequestId: () => 'request-2',
        reorderForNavigation,
      });
      return null;
    }
    act(() => { create(React.createElement(Harness)); });
    await act(async () => { await navigation?.startNavigation(later, 1); });

    expect(reorderForNavigation).toHaveBeenCalledWith([
      { id: 'destination-2', position: 0, day: 1 },
      { id: 'destination-1', position: 1, day: 1 },
    ]);
    expect(reorderForNavigation.mock.invocationCallOrder[0]).toBeLessThan(
      startSession.mock.invocationCallOrder[0],
    );
    expect(setSelectedIndex).toHaveBeenCalledWith(0);
    expect(startSession).toHaveBeenCalledWith(later.id, 'request-2');
  });

  it('skips startSession when reorderForNavigation returns false', async () => {
    const later = { ...destination, id: 'destination-2', order: 1 };
    const startSession = jest.fn().mockResolvedValue({
      id: 'session-2',
      status: 'active',
      destinationId: later.id,
    } as NavigationSession);
    const reorderForNavigation = jest.fn().mockResolvedValue(false);
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness() {
      navigation = useJourneyNavigation({
        state: pausedState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination, later],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        startSession,
        createRequestId: () => 'request-2',
        reorderForNavigation,
      });
      return null;
    }
    act(() => { create(React.createElement(Harness)); });
    await act(async () => { await navigation?.startNavigation(later, 1); });

    expect(reorderForNavigation).toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(navigation?.pendingLeaderTargetId).toBeNull();
  });

  it('uses the persisted active destination instead of the local carousel selection', () => {
    const other = { ...destination, id: 'destination-2', title: '其他地點' };
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
      destinations: [destination, other],
    } as GroupState;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination, other],
        selectedDestination: other,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });

    expect(navigation?.navTarget?.id).toBe(destination.id);
  });

  it('keeps the persisted target active after its completed card leaves the carousel', () => {
    const next = { ...destination, id: 'destination-2', order: 1 };
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
      destinations: [destination, next],
    } as GroupState;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [next],
        navigationDestinations: [destination, next],
        selectedDestination: next,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });

    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.journeyActive).toBe(true);
  });

  it('does not delete or auto-advance the gathering point at 30 metres', () => {
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
    } as GroupState;

    function Harness() {
      useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: destination.coordinates,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });

    expect(deleteDestination).not.toHaveBeenCalled();
  });

  it('followers mirror leader journey so the route polyline target is shared', () => {
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
    } as GroupState;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    const setSelectedIndex = jest.fn();

    function Harness() {
      navigation = useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: false,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: { latitude: 25.04, longitude: 121.51 },
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });

    expect(navigation?.journeyActive).toBe(true);
    expect(navigation?.journeyGoing).toBe(true);
    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.activePoint?.id).toBe(destination.id);
    expect(setSelectedIndex).toHaveBeenCalledWith(0);
  });

  it('followers end shared navigation when the leader pauses the server journey', () => {
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
    } as GroupState;
    const pausedFromServer = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'paused',
        activeDestinationId: undefined,
      },
    } as GroupState;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness({ state }: { state: GroupState }) {
      navigation = useJourneyNavigation({
        state,
        groupId: 'group-1',
        isLeader: false,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
      });
      return null;
    }

    let renderer: { update: (nextElement: React.ReactElement) => void };
    act(() => {
      renderer = create(React.createElement(Harness, { state: goingState }));
    });
    expect(navigation?.journeyActive).toBe(true);

    act(() => {
      renderer.update(React.createElement(Harness, { state: pausedFromServer }));
    });
    expect(navigation?.journeyActive).toBe(false);
    expect(navigation?.navTarget).toBeUndefined();
  });

  it('restores the persisted target when stopping navigation fails', async () => {
    const cancelSession = jest.fn().mockRejectedValueOnce(new Error('network'));
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
    } as GroupState;
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        cancelSession,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    await act(async () => {
      await navigation?.stopNavigation();
    });

    expect(navigation?.journeyStatus).toBe('going');
    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.journeyActive).toBe(true);
  });
});
