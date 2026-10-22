import React, { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CoreOperation } from '../types/coreData';

import {
  MapArrivalOutboxResource,
  MapCardWorkloadResource,
  MapForegroundNavigationResource,
  MapNavigationStartFrameResource,
  MapProgressDeadlineResource,
  MapRouteScopePreferenceResource,
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
const mockGetItem = jest.fn<Promise<string | null>, [string]>();
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
jest.mock('../state/energyObservability', () => ({
  energyObservability: { mountWorkload: (...args: Parameters<typeof mockMountWorkload>) => mockMountWorkload(...args), setTrackingMode: jest.fn() },
}));
jest.mock('../state/locationSharingSync', () => ({ hydrateLocationSharing: jest.fn() }));
jest.mock('../state/journeyNotifications', () => ({ notifyJourneyApproach: jest.fn() }));
jest.mock('../featureTour', () => ({ readAddPlaceTourCompletedLocal: jest.fn(), retryPendingAddPlaceTourAccountSync: jest.fn() }));
jest.mock('../state/backgroundLocationRefresh', () => ({ consumePendingLocationPermission: jest.fn(), recoverPendingLocationRefreshes: jest.fn() }));
jest.mock('../native', () => ({ location: {} }));
jest.mock('../api/client', () => ({ listFavoritePlaces: jest.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapScreen named resources', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutboxLoads.length = 0;
    mockOutboxListeners.clear();
    mockAppListeners.clear();
  });
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    jest.useRealTimers();
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
    const props = { groupId: 'a', refresh, navigationSessionState: { refresh: sessionRefresh } };
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
          React.createElement(MapForegroundNavigationResource, { groupId: group, refresh, navigationSessionState: { refresh: sessionRefresh } })));
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

  it('cancels the old stale deadline on target/sample changes and unmount', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const publish = jest.fn();
    const target = { id: 'target' };
    const props = { journeyActive: true, navTarget: target, deviceCoordsAcceptedAtMs: 1_000, setProgressClockMs: publish, PERSONAL_PROGRESS_STALE_MS: 30_000 };
    // This seam needs only the domain target identity, matching the original trigger.
    act(() => { tree = create(React.createElement(MapProgressDeadlineResource, props)); });
    expect(publish).toHaveBeenCalledWith(1_000);
    act(() => { jest.advanceTimersByTime(5_000); });
    act(() => tree?.update(React.createElement(MapProgressDeadlineResource, { ...props, deviceCoordsAcceptedAtMs: 6_000 })));
    expect(jest.getTimerCount()).toBe(1);
    act(() => { jest.advanceTimersByTime(25_050); });
    expect(publish).toHaveBeenCalledTimes(2);
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
