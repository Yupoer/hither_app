jest.mock('../api/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
  },
}));
jest.mock('../utils/activityLog', () => ({ logEvent: jest.fn() }));
jest.mock('../native/externalNavigation', () => ({ presentExternalMapsChooser: jest.fn() }));
jest.mock('../state/endedNavigationSessions', () => {
  const actual = jest.requireActual('../state/endedNavigationSessions') as typeof import('../state/endedNavigationSessions');
  return {
    ...actual,
    readEndedNavigationSessions: jest.fn(),
    rememberEndedNavigationSession: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../state/appNotice', () => ({
  showAppNotice: jest.fn(),
  showOperationFailure: jest.fn(),
}));
import React from 'react';
import { deleteDestination, reorderDestinations } from '../api/client';
import {
  abortLeaderGatheringStart,
  enqueueLeaderGatheringEnd,
  enqueueLeaderGatheringStart,
  enqueueLeaderGatheringSwitch,
  flushCoreOperationOutbox,
} from '../state/coreDataSync';
import {
  legacyNavigationSessionKey,
  readEndedNavigationSessions,
} from '../state/endedNavigationSessions';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import type { Destination, GroupState } from '../types';
import type { ActiveGatheringState } from '../types/coreData';
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

jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ getOperation: jest.fn(async () => null) }),
  abortLeaderGatheringStart: jest.fn().mockResolvedValue(undefined),
  enqueueLeaderGatheringStart: jest.fn(),
  enqueueLeaderGatheringSwitch: jest.fn(),
  enqueueLeaderGatheringEnd: jest.fn(),
  flushCoreOperationOutbox: jest.fn().mockResolvedValue(undefined),
}));

const baseGathering = {
  groupId: 'group-1',
  phase: 'staying',
  activeDestinationId: null,
  version: 0,
} as unknown as ActiveGatheringState;

const optimisticGathering = {
  groupId: 'group-1',
  phase: 'en_route',
  activeDestinationId: 'destination-1',
  version: 1,
} as unknown as ActiveGatheringState;

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
  const pausedGathering = {
    groupId: 'group-1',
    journeyPhase: 'staying',
    activeDestinationId: 'destination-1',
    pointStatuses: { 'destination-1': 'pending' },
    phaseChangedAt: 2_000,
    entityVersion: 2,
  } as unknown as ActiveGatheringState;

  beforeEach(() => {
    jest.mocked(enqueueLeaderGatheringStart).mockReset();
    jest.mocked(enqueueLeaderGatheringSwitch).mockReset();
    jest.mocked(enqueueLeaderGatheringEnd).mockReset();
    jest.mocked(abortLeaderGatheringStart).mockReset();
    jest.mocked(flushCoreOperationOutbox).mockReset();
    jest.mocked(enqueueLeaderGatheringStart).mockImplementation(async (_group, options) => ({
      local: optimisticGathering, base: baseGathering, operationId: options?.operationId ?? 'op-start-1',
    }));
    jest.mocked(enqueueLeaderGatheringSwitch).mockResolvedValue({
      local: optimisticGathering,
      base: baseGathering,
      operationId: 'op-switch-1',
    });
    jest.mocked(enqueueLeaderGatheringEnd).mockResolvedValue({
      local: pausedGathering,
    });
    jest.mocked(abortLeaderGatheringStart).mockResolvedValue(undefined);
    jest.mocked(flushCoreOperationOutbox).mockResolvedValue(undefined as never);
    jest.mocked(readEndedNavigationSessions).mockResolvedValue(new Set());
  });

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
    expect(startSession).not.toHaveBeenCalled();
    expect(enqueueLeaderGatheringStart).toHaveBeenCalledWith('group-1', expect.objectContaining({ operationId: 'request-1', activeDestinationId: destination.id }));
  });

  it('switches an active point without ending or completing the old point', async () => {
    const later = { ...destination, id: 'destination-2', order: 1 };
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
      destinations: [destination, later],
    } as GroupState;
    const startSession = jest.fn().mockResolvedValue({
      id: 'session-switch',
      status: 'active',
      destinationId: later.id,
    } as NavigationSession);
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness() {
      navigation = useJourneyNavigation({
        state: goingState,
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination, later],
        selectedDestination: later,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: (key) => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        startSession,
        createRequestId: () => 'request-switch',
      });
      return null;
    }
    act(() => { create(React.createElement(Harness)); });
    await act(async () => { await navigation?.startNavigation(later, 1); });

    expect(enqueueLeaderGatheringSwitch).toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({ activeDestinationId: later.id, flushImmediately: false }),
    );
    expect(startSession).not.toHaveBeenCalled();
    expect(enqueueLeaderGatheringStart).not.toHaveBeenCalled();
  });

  it('queues the selected later stop and shows it without waiting for remote reorder', async () => {
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

    expect(reorderForNavigation).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(enqueueLeaderGatheringStart).toHaveBeenCalledWith('group-1',
      expect.objectContaining({ activeDestinationId: later.id, operationId: 'request-2' }));
    expect(setSelectedIndex).toHaveBeenCalledWith(1);
    expect(navigation?.navTarget?.id).toBe(later.id);
  });

  it('does not let the obsolete remote reorder gate block a durable local Start', async () => {
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

    expect(reorderForNavigation).not.toHaveBeenCalled();
    expect(enqueueLeaderGatheringStart).toHaveBeenCalledWith('group-1', expect.objectContaining({ activeDestinationId: later.id }));
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

  it('End navigation pauses flock travel and cancels session without completing the stop', async () => {
    const cancelSession = jest.fn().mockResolvedValue({ id: 'session-1', version: 2, status: 'cancelled' });
    const onOperatorPauseConfirm = jest.fn();
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
      },
    } as GroupState;
    const activeSession = {
      id: 'session-1',
      status: 'active',
      destinationId: destination.id,
      destination: {
        name: destination.title,
        coordinates: destination.coordinates,
        arrivalRadiusMeters: 50,
      },
      version: 1,
    } as NavigationSession;
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
        navigationSession: activeSession,
        cancelSession,
        onOperatorPauseConfirm,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    await act(async () => {
      await navigation?.stopNavigation();
    });

    expect(enqueueLeaderGatheringEnd).toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({ groupState: goingState }),
    );
    expect(cancelSession).not.toHaveBeenCalled();
    expect(onOperatorPauseConfirm).toHaveBeenCalledWith(destination, expect.stringMatching(/^pause:group-1:/));
    expect(navigation?.journeyStatus).toBe('paused');
    expect(navigation?.navTarget).toBeUndefined();
  });

  it('shows durable local navigation and attempts the outbox even when legacy startSession is offline', async () => {
    const startSession = jest
      .fn()
      .mockRejectedValue(new Error('TypeError: Network request failed'));
    const onOptimisticGathering = jest.fn();
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;

    function Harness() {
      navigation = useJourneyNavigation({
        state: pausedState,
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
        startSession,
        createRequestId: () => 'request-offline-1',
        onOptimisticGathering,
      });
      return null;
    }

    act(() => {
      create(React.createElement(Harness));
    });
    await act(async () => {
      await navigation?.startNavigation(destination, 0);
    });

    expect(enqueueLeaderGatheringStart).toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({
        activeDestinationId: destination.id,
        flushImmediately: false,
      }),
    );
    expect(startSession).not.toHaveBeenCalled();
    // The durable RPC owns session creation and retry; local UI never awaits it.
    expect(flushCoreOperationOutbox).toHaveBeenCalled();
    expect(abortLeaderGatheringStart).not.toHaveBeenCalled();
    expect(onOptimisticGathering).toHaveBeenCalledWith(optimisticGathering);
    // Optimistic target stays for reconnect; outbox remains pending.
    expect(navigation?.navTarget?.id).toBe(destination.id);
    expect(navigation?.journeyActive).toBe(true);
  });
  it('notifies the operator when Realtime confirms a start whose response was lost', async () => {
    const onOperatorStartConfirm = jest.fn();
    const startSession = jest.fn().mockRejectedValue(new Error('Network request failed'));
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness({ session }: { session: NavigationSession | null }) {
      navigation = useJourneyNavigation({ state: pausedState, groupId: 'group-1', isLeader: true,
        destinations: [destination], selectedDestination: destination, fromCoords: undefined,
        refresh: jest.fn(), t: key => key, mapRef: { current: null }, carouselRef: { current: null },
        setSelectedIndex: jest.fn(), startSession, navigationSession: session,
        createRequestId: () => 'retry-request', onOperatorStartConfirm });
      return null;
    }
    let tree: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(Harness, { session: null })); });
    await act(async () => { await navigation?.startNavigation(destination, 0); });
    expect(onOperatorStartConfirm).not.toHaveBeenCalled();
    const session = { id: 'retried-session', destinationId: destination.id,
      requestId: 'retry-request', status: 'active', destination: { name: destination.title,
        coordinates: destination.coordinates, arrivalRadiusMeters: 50 } } as NavigationSession;
    await act(async () => { tree.update(React.createElement(Harness, { session })); });
    await act(async () => { tree.update(React.createElement(Harness, { session })); });
    expect(onOperatorStartConfirm).toHaveBeenCalledTimes(1);
    expect(onOperatorStartConfirm).toHaveBeenCalledWith(destination, 'start:group-1:retry-request');
  });

  it('keeps an ended legacy session hidden when the server session id arrives later', async () => {
    const startedAt = '2026-09-22T18:00:00.123456+08:00';
    const serverStartedAt = '2026-09-22T10:00:00.123Z';
    const goingState = {
      ...pausedState,
      group: {
        ...pausedState.group,
        journeyStatus: 'going',
        activeDestinationId: destination.id,
        journeyStartedAt: startedAt,
      },
    } as GroupState;
    const activeSession = {
      id: 'server-session-after-load',
      status: 'active',
      destinationId: destination.id,
      startedAt: serverStartedAt,
      destination: {
        name: destination.title,
        coordinates: destination.coordinates,
        arrivalRadiusMeters: 50,
      },
    } as NavigationSession;
    jest.mocked(readEndedNavigationSessions).mockResolvedValue(
      new Set([legacyNavigationSessionKey(startedAt, destination.id)]),
    );
    let navigation: ReturnType<typeof useJourneyNavigation> | undefined;
    function Harness({ session }: { session?: NavigationSession }) {
      navigation = useJourneyNavigation({
        state: goingState,
        actorId: 'actor-a',
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: key => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: session,
      });
      return null;
    }

    let tree: { update: (nextElement: React.ReactElement) => void };
    await act(async () => {
      tree = create(React.createElement(Harness, { session: undefined }));
    });
    await act(async () => {
      tree.update(React.createElement(Harness, { session: activeSession }));
    });

    expect(navigation?.navTarget).toBeUndefined();
    expect(navigation?.sharedTargetId).toBeNull();
    expect(navigation?.navigationStoppedLocally).toBe(true);
  });

  it('fails closed when ended-session persistence cannot be read', async () => {
    jest.mocked(readEndedNavigationSessions).mockRejectedValue(new Error('storage unavailable'));
    const activeSession = {
      id: 'active-session',
      status: 'active',
      destinationId: destination.id,
      startedAt: '2026-09-22T10:00:00.000Z',
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
        actorId: 'actor-a',
        groupId: 'group-1',
        isLeader: true,
        destinations: [destination],
        selectedDestination: destination,
        fromCoords: undefined,
        refresh: jest.fn(),
        t: key => key,
        mapRef: { current: null },
        carouselRef: { current: null },
        setSelectedIndex: jest.fn(),
        navigationSession: activeSession,
      });
      return null;
    }

    await act(async () => {
      create(React.createElement(Harness));
    });

    expect(navigation?.navTarget).toBeUndefined();
    expect(navigation?.sharedTargetId).toBeNull();
    expect(navigation?.navigationStoppedLocally).toBe(true);
  });

});
