import React from 'react';
import { deleteDestination, setJourneyTarget } from '../api/client';
import { useJourneyNavigation } from '../screens/MapScreen/hooks/useJourneyNavigation';
import type { Destination, GroupState } from '../types';

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
  setJourneyTarget: jest.fn(),
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
  beforeEach(() => {
    jest.mocked(setJourneyTarget).mockResolvedValue(undefined);
  });

  it('keeps navigation active when refresh still returns the old paused snapshot', async () => {
    const refresh = jest.fn().mockResolvedValue(true);
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
    expect(setJourneyTarget).toHaveBeenCalledWith('group-1', destination.id);
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

  it('restores the persisted target when stopping navigation fails', async () => {
    jest.mocked(setJourneyTarget).mockRejectedValueOnce(new Error('network'));
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
