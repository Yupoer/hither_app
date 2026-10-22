import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { startBackgroundJourney } from '../state/backgroundJourney';
import { MapBackgroundLocationResource, type MapBackgroundLocationInput } from '../screens/MapScreen/MapBackgroundLocationResource';
import { MapJourneyBaselineResource, useMapJourneyProgressPublication, type MapJourneyBaselineInput } from '../screens/MapScreen/MapJourneyProgressResources';
import { mapJourneyResourceInput } from './fixtures/mapJourneyResourceInput';

const mockEvents: string[] = [];
const mockNativeIntent = jest.fn(async (enabled: boolean) => { mockEvents.push(`native:${enabled}`); });
const mockPrepare = jest.fn<Promise<'ready' | 'permission_denied'>, [boolean, boolean]>(async () => 'ready');
const mockStart = jest.fn(async (input: Parameters<typeof startBackgroundJourney>[0]) => { mockEvents.push(`start:${input.initialDistanceM}`); return 'started' as const; });
const mockStop = jest.fn(async (_clear?: boolean) => { mockEvents.push('stop'); });
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('../native/backgroundLocation', () => ({ prepareNativeBackgroundLocation: (enabled: boolean) => mockNativeIntent(enabled) }));
jest.mock('../state/backgroundJourney', () => ({
  prepareBackgroundJourneyPermissions: (...args: Parameters<typeof mockPrepare>) => mockPrepare(...args),
  startBackgroundJourney: (...args: Parameters<typeof mockStart>) => mockStart(...args),
  stopBackgroundJourney: (...args: Parameters<typeof mockStop>) => mockStop(...args),
}));
jest.mock('../state/backgroundLocationRefresh', () => ({ rememberPendingLocationPermission: jest.fn() }));
jest.mock('../state/locationOutbox', () => ({ purgeLocationOutbox: jest.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function backgroundInput(baseline: MapJourneyBaselineInput): MapBackgroundLocationInput {
  const members: MapBackgroundLocationInput['members'] = [{ userId: 'actor', name: 'Actor', role: 'leader', status: 'active' }];
  return {
    backgroundSharingScope: 'actor:group', groupId: 'group', backgroundStartedKeyRef: { current: null },
    backgroundPermissionAttemptedRef: { current: null }, setBackgroundPermissionsPreparedFor: jest.fn(), appState: 'background',
    backgroundPermissionDeniedRef: { current: null }, sharingEnabled: true, backgroundPermissionsPreparedFor: 'group:journey',
    backgroundPermissionProfileKey: 'group:journey', backgroundPermissionPrepareInFlightRef: { current: null },
    effectiveNavigationActive: true, language: 'en', backgroundJourneyWantedRef: { current: 'actor:group' },
    backgroundPermissionProfileRef: { current: 'group:journey' }, navTarget: baseline.navTarget, myScopeId: undefined,
    deviceCoords: baseline.deviceCoords, resolveCurrentNavigationSessionId: jest.fn(() => 'session'), pendingLeaderTargetId: null,
    highAccuracy: false, travelMode: 'walk', localArrivalRadiusM: 50, canEditItinerary: true, members, sessionEligibleMembers: members,
    initialJourneyRef: baseline.initialJourneyRef, user: { id: 'actor' }, activeDestinationArrivals: [], state: { subgroups: [] },
    lastValidPresentation: { distanceM: null, etaSeconds: null, progress: null, travelMode: 'walk' }, lastRouteDistanceM: undefined,
    colors: { accent: '#ffffff' }, membership: { group: { name: 'Group' } }, journeyStartCoords: null,
    progressDepartedStart: false, progressMaxSticky: null, backgroundEtaRef: { current: {} }, selfRoute: { expectedTravelTimeSeconds: 500 },
    mapFocused: true, preferencesReady: true, localNavigationSessionId: null, journeyActive: true,
    navigationSessionId: 'session', hasNavigationSession: true, navigationStoppedLocally: false, showLocationPermissionAlert: jest.fn(),
  };
}

function Owner({ baseline, background }: { baseline: MapJourneyBaselineInput; background: MapBackgroundLocationInput }) {
  const publish = useMapJourneyProgressPublication();
  return React.createElement(React.Fragment, null,
    React.createElement(MapBackgroundLocationResource, { ...background, baselineInput: baseline, publishBaseline: publish }),
    React.createElement(MapJourneyBaselineResource, { input: baseline, publishBaseline: publish }));
}

describe('Map background GPS handoff resource', () => {
  let tree: ReactTestRenderer | undefined;
  beforeEach(() => { jest.clearAllMocks(); mockEvents.length = 0; mockPrepare.mockImplementation(async () => 'ready'); });
  afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

  it('publishes the latest locked baseline before GPS handoff and orders native intent before foreground stop', async () => {
    const baseline = mapJourneyResourceInput();
    baseline.setInitialDistanceM = value => { mockEvents.push(`baseline:${value}`); };
    const background = { ...backgroundInput(baseline), appState: 'active' as const };
    await act(async () => { tree = create(React.createElement(Owner, { baseline, background })); });
    expect(mockEvents).toEqual(['baseline:1000', 'native:true', 'stop']);
    const nextBaseline = { ...baseline, navTarget: baseline.navTarget ? { ...baseline.navTarget, id: 'next' } : undefined,
      selfRoute: { distanceMeters: 2_000 } };
    const nextBackground = { ...background, appState: 'background' as const, navTarget: nextBaseline.navTarget };
    await act(async () => tree?.update(React.createElement(Owner, { baseline: nextBaseline, background: nextBackground })));
    expect(mockEvents.slice(-2)).toEqual(['baseline:2000', 'start:2000']);
    expect(mockStart).toHaveBeenLastCalledWith(expect.objectContaining({ initialDistanceM: 2_000, destinationId: 'next', navigationSessionId: 'session' }));
  });

  it('retains object and callback reevaluation while the meaningful background key deduplicates starts', async () => {
    const baseline = mapJourneyResourceInput();
    const background = backgroundInput(baseline);
    await act(async () => { tree = create(React.createElement(Owner, { baseline, background })); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    const resolve = jest.fn(() => 'session');
    let next = { ...background, resolveCurrentNavigationSessionId: resolve };
    await act(async () => tree?.update(React.createElement(Owner, { baseline, background: next })));
    expect(resolve).toHaveBeenCalledTimes(1);
    next = { ...next, members: [...next.members] };
    await act(async () => tree?.update(React.createElement(Owner, { baseline, background: next })));
    expect(resolve).toHaveBeenCalledTimes(2);
    await act(async () => tree?.update(React.createElement(Owner, { baseline, background: { ...next } })));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockNativeIntent).not.toHaveBeenCalled();
    act(() => tree?.unmount()); tree = undefined;
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('keeps permission flight ownership through input changes and fences completion from a retired profile', async () => {
    let finish: (value: 'ready') => void = () => undefined;
    mockPrepare.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const baseline = mapJourneyResourceInput();
    const background = { ...backgroundInput(baseline), appState: 'active' as const, backgroundPermissionsPreparedFor: null };
    await act(async () => { tree = create(React.createElement(Owner, { baseline, background })); });
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    await act(async () => tree?.update(React.createElement(Owner, { baseline, background: { ...background, language: 'zh-TW' } })));
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    background.backgroundPermissionProfileRef.current = 'retired';
    await act(async () => { finish('ready'); });
    expect(background.setBackgroundPermissionsPreparedFor).not.toHaveBeenCalled();
    expect(background.backgroundPermissionPrepareInFlightRef.current).toBeNull();
  });

  it('preserves native intent dependency boundaries under Strict replay without per-input GPS cleanup', async () => {
    const baseline = mapJourneyResourceInput();
    const background = { ...backgroundInput(baseline), appState: 'active' as const };
    await act(async () => { tree = create(React.createElement(React.StrictMode, null, React.createElement(Owner, { baseline, background }))); });
    expect(mockNativeIntent).toHaveBeenCalledTimes(2);
    await act(async () => tree?.update(React.createElement(React.StrictMode, null,
      React.createElement(Owner, { baseline, background: { ...background, highAccuracy: true } }))));
    expect(mockNativeIntent).toHaveBeenCalledTimes(2);
    await act(async () => tree?.update(React.createElement(React.StrictMode, null,
      React.createElement(Owner, { baseline, background: { ...background, highAccuracy: true, effectiveNavigationActive: false } }))));
    expect(mockNativeIntent).toHaveBeenCalledTimes(3);
    expect(mockNativeIntent).toHaveBeenLastCalledWith(false);
  });
});
