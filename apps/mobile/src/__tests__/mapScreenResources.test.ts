import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CoreOperation } from '../types/coreData';

import {
  MapArrivalOutboxResource,
  MapCardWorkloadResource,
  MapForegroundNavigationResource,
  MapNavigationStartFrameResource,
  MapProgressDeadlineResource,
  MapRouteCameraResource,
  MapRouteScopePreferenceResource,
  MapSharingHydrationResource,
} from '../screens/MapScreen/MapScreenResources';

const mockOutboxLoads: { group: string; finish: (rows: CoreOperation[]) => void }[] = [];
const mockOutboxListeners = new Set<() => void>();
const mockOutboxSubscribe = jest.fn((listener: () => void) => {
  mockOutboxListeners.add(listener);
  listener();
  return () => { mockOutboxListeners.delete(listener); };
});
const mockAppListeners = new Set<(state: string) => void>();
const mockAppSubscribe = jest.fn((_event: string, listener: (state: string) => void) => {
  mockAppListeners.add(listener);
  return { remove: () => { mockAppListeners.delete(listener); } };
});
type GroupSyncListener = Parameters<typeof import('../state/groupSync').subscribeGroupSyncSnapshots>[0];
const mockGroupSyncListeners = new Set<GroupSyncListener>();
const mockGroupSyncSubscribe = jest.fn((listener: GroupSyncListener) => {
  mockGroupSyncListeners.add(listener);
  return () => { mockGroupSyncListeners.delete(listener); };
});
const mockRecoverPending = jest.fn(async (..._args: unknown[]) => undefined);
const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSharingLoads: { actor: string; resolve: (value: boolean | null) => void; reject: (error: Error) => void }[] = [];
const mockLeaseRelease = jest.fn();
const mockMountWorkload = jest.fn((_input: { mountedCardCount: number }) => mockLeaseRelease);

jest.mock('react-native', () => ({
  AppState: { addEventListener: (...args: Parameters<typeof mockAppSubscribe>) => mockAppSubscribe(...args) },
  Keyboard: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
}));
jest.mock('../state/coreDataSync', () => ({
  getCoreOperationOutbox: () => ({ listByGroup: (group: string) => new Promise<CoreOperation[]>(finish => {
    mockOutboxLoads.push({ group, finish });
  }) }),
  subscribeCoreOutboxChanges: (listener: () => void) => mockOutboxSubscribe(listener),
}));
jest.mock('../state/groupSync', () => ({
  subscribeGroupSyncSnapshots: (listener: GroupSyncListener) => mockGroupSyncSubscribe(listener),
}));
jest.mock('../state/energyObservability', () => ({
  energyObservability: { mountWorkload: (...args: Parameters<typeof mockMountWorkload>) => mockMountWorkload(...args), setTrackingMode: jest.fn() },
}));
jest.mock('../state/locationSharingSync', () => ({
  hydrateLocationSharing: (actor: string) => new Promise<boolean | null>((resolve, reject) => {
    mockSharingLoads.push({ actor, resolve, reject });
  }),
}));
jest.mock('../state/journeyNotifications', () => ({ notifyJourneyApproach: jest.fn() }));
jest.mock('../featureTour', () => ({ readAddPlaceTourCompletedLocal: jest.fn(), retryPendingAddPlaceTourAccountSync: jest.fn() }));
jest.mock('../state/backgroundLocationRefresh', () => ({ consumePendingLocationPermission: jest.fn(), recoverPendingLocationRefreshes: (...args: unknown[]) => mockRecoverPending(...args) }));
jest.mock('../native', () => ({ location: {} }));
jest.mock('../api/client', () => ({ listFavoritePlaces: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapScreen named resources', () => {
  let tree: ReactTestRenderer | undefined;

  it('keeps stop-detail focus through late routes and fits the deferred mode after details close', async () => {
    const fitRoute = jest.fn();
    const lastFittedRouteRef = { current: null };
    const point = { latitude: 25, longitude: 121 };
    const route = { points: [point], distanceMeters: 500, expectedTravelTimeSeconds: 300 };
    const props: React.ComponentProps<typeof MapRouteCameraResource> = {
      allowAutoFit: false, activePoint: { id: 'stop', title: 'Stop', order: 0, day: 1, coordinates: point },
      travelMode: 'walk', lastFittedRouteRef,
      selfRoute: route,
      mapRef: { current: { fitRoute, recenter: jest.fn(), centerOn: jest.fn(), focusOblique: jest.fn(), fitToMembers: jest.fn() } },
      deviceCoords: { latitude: 25.01, longitude: 121 },
    };
    await act(async () => { tree = create(React.createElement(MapRouteCameraResource, props)); });
    await act(async () => tree?.update(React.createElement(MapRouteCameraResource, { ...props,
      selfRoute: { ...route, expectedTravelTimeSeconds: 280 },
    })));
    expect(fitRoute).not.toHaveBeenCalled();
    await act(async () => tree?.update(React.createElement(MapRouteCameraResource, { ...props, allowAutoFit: true })));
    expect(fitRoute).toHaveBeenCalledTimes(1);
    await act(async () => tree?.update(React.createElement(MapRouteCameraResource, { ...props, travelMode: 'drive' })));
    expect(fitRoute).toHaveBeenCalledTimes(1);
    await act(async () => tree?.update(React.createElement(MapRouteCameraResource, { ...props, allowAutoFit: true, travelMode: 'drive' })));
    expect(fitRoute).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutboxLoads.length = 0;
    mockSharingLoads.length = 0;
    mockOutboxListeners.clear();
    mockAppListeners.clear();
    mockGroupSyncListeners.clear();
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
  });

  it('applies stored sharing after preferences become ready under Strict replay', async () => {
    const publish = jest.fn();
    const claim = { current: null as string | null };
    const render = (ready: boolean, actor = 'alice') => React.createElement(React.StrictMode, null,
      React.createElement(MapSharingHydrationResource, {
        preferencesReady: ready, user: { id: actor }, privacyHydratedUserRef: claim, setSharingEnabled: publish,
      }));
    act(() => { tree = create(render(false)); });
    expect(mockSharingLoads).toHaveLength(0);
    act(() => tree?.update(render(true)));
    await act(async () => { for (const load of mockSharingLoads) load.resolve(false); });
    expect(publish.mock.calls).toEqual([[false]]);
    const count = mockSharingLoads.length;
    act(() => tree?.update(render(false)));
    act(() => tree?.update(render(true)));
    expect(mockSharingLoads).toHaveLength(count);
    act(() => tree?.update(render(true, 'bob')));
    await act(async () => { for (const load of mockSharingLoads.slice(count)) load.resolve(true); });
    expect(publish.mock.calls).toEqual([[false], [true]]);
  });

  it('isolates pending sharing hydration across account changes, callback replacement and unmount', async () => {
    const publish = jest.fn();
    const replacement = jest.fn();
    const claim = { current: null as string | null };
    const render = (actor: string, callback = publish) => React.createElement(MapSharingHydrationResource, {
      preferencesReady: true, user: { id: actor }, privacyHydratedUserRef: claim, setSharingEnabled: callback,
    });
    act(() => { tree = create(render('alice')); });
    act(() => tree?.update(render('bob')));
    act(() => tree?.update(render('alice')));
    await act(async () => {
      mockSharingLoads[0].reject(new Error('old alice request'));
      mockSharingLoads[1].resolve(true);
    });
    expect(claim.current).toBe('alice');
    expect(publish).not.toHaveBeenCalled();
    act(() => tree?.update(render('alice', replacement)));
    expect(mockSharingLoads.map(load => load.actor)).toEqual(['alice', 'bob', 'alice', 'alice']);
    await act(async () => { mockSharingLoads[2].resolve(true); mockSharingLoads[3].resolve(false); });
    expect(publish).not.toHaveBeenCalled();
    expect(replacement.mock.calls).toEqual([[false]]);
    act(() => tree?.update(render('bob', replacement)));
    act(() => tree?.unmount());
    tree = undefined;
    expect(claim.current).toBeNull();
    await act(async () => { mockSharingLoads[4].resolve(true); });
    expect(replacement.mock.calls).toEqual([[false]]);
  });

  it('installs the outbox listener, fences late loads across actor/group replacement and releases subscriptions', async () => {
    const publish = jest.fn();
    const user = { id: 'alice' };
    act(() => { tree = create(React.createElement(MapArrivalOutboxResource, { groupId: 'a', user, setArrivalOperations: publish })); });
    expect(mockOutboxSubscribe).toHaveBeenCalledTimes(1);
    expect(mockOutboxLoads).toHaveLength(2);
    act(() => tree?.update(React.createElement(MapArrivalOutboxResource, { groupId: 'a', user: { id: 'alice' }, setArrivalOperations: publish })));
    expect(mockOutboxSubscribe).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapArrivalOutboxResource, { groupId: 'b', user: { id: 'bob' }, setArrivalOperations: publish })));
    expect(mockOutboxListeners.size).toBe(1);
    await act(async () => { mockOutboxLoads[0].finish([]); mockOutboxLoads[1].finish([]); });
    expect(publish).not.toHaveBeenCalled();
    await act(async () => { mockOutboxLoads[2].finish([]); });
    expect(publish).toHaveBeenCalledTimes(1);
    act(() => tree?.unmount());
    tree = undefined;
    expect(mockOutboxListeners.size).toBe(0);
    await act(async () => { mockOutboxLoads[3].finish([]); });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('replaces foreground subscriptions for callback identity and balances Strict replay', () => {
    const refresh = jest.fn(async () => true);
    const nextRefresh = jest.fn(async () => true);
    const sessionRefresh = jest.fn(async () => null);
    const props = { groupId: 'a', actorId: 'alice', refresh, navigationSessionState: { refresh: sessionRefresh } };
    act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(MapForegroundNavigationResource, props))); });
    expect(mockAppSubscribe).toHaveBeenCalledTimes(2);
    expect(mockAppListeners.size).toBe(1);
    act(() => tree?.update(React.createElement(React.StrictMode, null, React.createElement(MapForegroundNavigationResource, { ...props, navigationSessionState: { refresh: sessionRefresh } }))));
    expect(mockAppSubscribe).toHaveBeenCalledTimes(2);
    act(() => tree?.update(React.createElement(React.StrictMode, null, React.createElement(MapForegroundNavigationResource, { ...props, refresh: nextRefresh }))));
    for (const listener of mockAppListeners) listener('active');
    expect(refresh).not.toHaveBeenCalled();
    expect(nextRefresh).toHaveBeenCalledTimes(1);
    expect(sessionRefresh).toHaveBeenCalledTimes(1);
    act(() => tree?.unmount());
    tree = undefined;
    expect(mockAppListeners.size).toBe(0);
  });

  it('consumes supplied refresh commands only for the mounted actor and group and releases the listener', () => {
    const refresh = jest.fn(async () => true);
    const sessionRefresh = jest.fn(async () => null);
    const render = (actorId: string | null, groupId: string) => React.createElement(MapForegroundNavigationResource, {
      actorId, groupId, refresh, navigationSessionState: { refresh: sessionRefresh },
    });
    const recovery = (groupId: string): Parameters<GroupSyncListener>[1] => ({
      state: {
        group: { id: groupId, name: 'Flock', inviteCode: 'INVITE', createdBy: 'alice', journeyStatus: 'paused',
          stragglerAlerts: false, stragglerThresholdM: 100 },
        members: [], destinations: [], subgroups: [],
      },
      generatedAt: null, revision: '2026-11-02T00:00:00Z', entityVersions: {},
    });
    const pending = [{ groupId: 'a', requestedBy: 'peer', requestedAt: '2026-11-02T00:00:01.123456Z' }];
    act(() => { tree = create(render('alice', 'a')); });
    const aliceListener = mockGroupSyncSubscribe.mock.calls[0][0];
    aliceListener('bob', recovery('a'), pending);
    aliceListener('alice', recovery('b'), pending);
    aliceListener('alice', recovery('a'), []);
    expect(mockRecoverPending).not.toHaveBeenCalled();
    aliceListener('alice', recovery('a'), pending);
    expect(mockRecoverPending.mock.calls).toEqual([[pending]]);

    act(() => tree?.update(render('bob', 'a')));
    expect(mockGroupSyncListeners.size).toBe(1);
    const bobListener = mockGroupSyncSubscribe.mock.calls[1][0];
    aliceListener('alice', recovery('a'), pending);
    bobListener('alice', recovery('a'), pending);
    expect(mockRecoverPending).toHaveBeenCalledTimes(1);
    bobListener('bob', recovery('a'), pending);
    expect(mockRecoverPending).toHaveBeenCalledTimes(2);

    act(() => tree?.update(render('bob', 'b')));
    const nextGroupListener = mockGroupSyncSubscribe.mock.calls[2][0];
    bobListener('bob', recovery('a'), pending);
    nextGroupListener('bob', recovery('a'), pending);
    expect(mockRecoverPending).toHaveBeenCalledTimes(2);
    const nextPending = [{ ...pending[0], groupId: 'b' }];
    nextGroupListener('bob', recovery('b'), nextPending);
    expect(mockRecoverPending).toHaveBeenLastCalledWith(nextPending);

    act(() => tree?.update(render(null, 'b')));
    const signedOutListener = mockGroupSyncSubscribe.mock.calls[3][0];
    signedOutListener('bob', recovery('b'), nextPending);
    expect(mockRecoverPending).toHaveBeenCalledTimes(3);
    act(() => tree?.unmount());
    tree = undefined;
    nextGroupListener('bob', recovery('b'), nextPending);
    expect(mockRecoverPending).toHaveBeenCalledTimes(3);
    expect(mockGroupSyncListeners.size).toBe(0);
    expect(mockAppListeners.size).toBe(0);
  });

  it('preserves Object.is coordinates and callback identity without resetting owner drafts', () => {
    const refresh = jest.fn();
    const nextRefresh = jest.fn();
    const a = { latitude: 25, longitude: 121 };
    const b = { ...a };
    let editDraft: React.Dispatch<React.SetStateAction<string>> = () => undefined;
    let currentDraft = '';
    function Owner({ coords, callback }: { coords: typeof a; callback: () => void }) {
      const [draft, setDraft] = useState('initial');
      editDraft = setDraft;
      currentDraft = draft;
      return React.createElement(MapNavigationStartFrameResource, { deviceCoords: coords, refreshStartFrame: callback });
    }
    act(() => { tree = create(React.createElement(Owner, { coords: a, callback: refresh })); });
    act(() => { editDraft('unsaved'); });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(Owner, { coords: b, callback: refresh })));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => tree?.update(React.createElement(Owner, { coords: a, callback: refresh })));
    expect(refresh).toHaveBeenCalledTimes(3);
    act(() => tree?.update(React.createElement(Owner, { coords: a, callback: nextRefresh })));
    expect(nextRefresh).toHaveBeenCalledTimes(1);
    expect(currentDraft).toBe('unsaved');
  });

  it('isolates two domain generations during the same A to B commit and disposes both old jobs', async () => {
    const publish = jest.fn();
    const firstRefresh = jest.fn(async () => true);
    const secondRefresh = jest.fn(async () => true);
    const sessionRefresh = jest.fn(async () => null);
    function Owner({ group, refresh }: { group: string; refresh: typeof firstRefresh }) {
      return React.createElement(React.Fragment, null,
        React.createElement(React.Fragment, { key: 'map-owner-arrival-outbox' },
          React.createElement(MapArrivalOutboxResource, { groupId: group, user: { id: 'alice' }, setArrivalOperations: publish })),
        React.createElement(React.Fragment, { key: 'map-owner-foreground-navigation' },
          React.createElement(MapForegroundNavigationResource, { groupId: group, actorId: 'alice', refresh, navigationSessionState: { refresh: sessionRefresh } })));
    }
    act(() => { tree = create(React.createElement(Owner, { group: 'a', refresh: firstRefresh })); });
    act(() => tree?.update(React.createElement(Owner, { group: 'b', refresh: secondRefresh })));
    expect(mockOutboxListeners.size).toBe(1);
    expect(mockAppListeners.size).toBe(1);
    for (const listener of mockAppListeners) listener('active');
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    await act(async () => { mockOutboxLoads[0].finish([]); mockOutboxLoads[1].finish([]); });
    expect(publish).not.toHaveBeenCalled();
    act(() => tree?.unmount());
    tree = undefined;
    expect(mockOutboxListeners.size).toBe(0);
    expect(mockAppListeners.size).toBe(0);
  });

  it('uses card count rather than array identity and releases only the replaced workload lease', () => {
    const props = { uiVisible: true, destinations: [] };
    act(() => { tree = create(React.createElement(MapCardWorkloadResource, props)); });
    act(() => tree?.update(React.createElement(MapCardWorkloadResource, { ...props, destinations: [] })));
    expect(mockMountWorkload).toHaveBeenCalledTimes(1);
    act(() => tree?.update(React.createElement(MapCardWorkloadResource, { ...props, uiVisible: false })));
    expect(mockMountWorkload).toHaveBeenCalledTimes(2);
    expect(mockLeaseRelease).toHaveBeenCalledTimes(1);
  });

  it('checks raw stationary fixes before marking the map stale and cancels deadlines on unmount', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const publish = jest.fn();
    const target = { id: 'target' };
    const latestLocationSampleRef = { current: { coordinates: { latitude: 25, longitude: 121 }, timestamp: 1_000, accuracy: 5 } };
    const props = { journeyActive: true, navTarget: target, deviceCoordsAcceptedAtMs: 1_000, latestLocationSampleRef, setProgressClockMs: publish, PERSONAL_PROGRESS_STALE_MS: 30_000 };
    act(() => { tree = create(React.createElement(MapProgressDeadlineResource, props)); });
    expect(publish).toHaveBeenCalledWith(1_000);
    act(() => { jest.advanceTimersByTime(5_000); });
    latestLocationSampleRef.current = { ...latestLocationSampleRef.current, timestamp: 6_000 };
    expect(jest.getTimerCount()).toBe(1);
    act(() => { jest.advanceTimersByTime(25_050); });
    expect(publish).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(36_050);
    act(() => tree?.unmount());
    tree = undefined;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ignores reversed storage responses after route scope changes', async () => {
    const loads: ((value: string | null) => void)[] = [];
    mockGetItem.mockImplementation(() => new Promise(resolve => { loads.push(resolve); }));
    const publish = jest.fn();
    act(() => { tree = create(React.createElement(MapRouteScopePreferenceResource, { myScopeId: undefined, routeScopeStorageKey: 'a', setRouteScopeExpanded: publish })); });
    act(() => tree?.update(React.createElement(MapRouteScopePreferenceResource, { myScopeId: 'sub', routeScopeStorageKey: 'b', setRouteScopeExpanded: publish })));
    await act(async () => { loads[1]('{"main":true}'); });
    expect(publish).toHaveBeenCalledWith({ main: true, subgroup: true });
    await act(async () => { loads[0]('{"main":false}'); });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
