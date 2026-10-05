import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockAppState = { currentState: 'active' };
let mockAppListener: (state: string) => void;
const mockStop = jest.fn();
const mockWatch = jest.fn(async (_callback: unknown, _accuracy: unknown, _mode: unknown) => mockStop);
jest.mock('react-native', () => ({ AppState: { get currentState() { return mockAppState.currentState; },
  addEventListener: (_: string, listener: typeof mockAppListener) => { mockAppListener = listener; return { remove() {} }; } } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'sample' }));
jest.mock('../native', () => ({ location: { getCurrentLocation: jest.fn(async () => null),
  watchLocation: (...args: unknown[]) => mockWatch(...args as [unknown, unknown, unknown]) } }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { increment: jest.fn(), event: jest.fn() } }));
jest.mock('../native/debugLocation', () => ({ isDebugRouteActive: () => false, subscribeDebugLocation: () => () => {} }));
jest.mock('../state/locationOutbox', () => ({ enqueueLocationOutbox: jest.fn(async () => {}), flushLocationOutbox: jest.fn(async () => {}) }));
import { foregroundLocationConfiguration, locationPolicy } from '../utils/locationPolicy';
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('switches directly between MapKit navigation and one Low Expo paused owner, then stops on lock/share-off', async () => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockAppState.currentState = 'active';
  let config!: ReturnType<typeof foregroundLocationConfiguration>;
  const incoming = jest.fn();
  function Probe({ active, sharing = true }: { active: boolean; sharing?: boolean }) {
    config = foregroundLocationConfiguration({ navigationActive: active, nativeMapAvailable: true,
      highAccuracy: true, sharingEnabled: sharing, hasMembership: true, appState: mockAppState.currentState });
    useDeviceLocation({ groupId: 'group', highAccuracy: config.highAccuracy, powerMode: config.powerMode,
      teamNavigationActive: active, nativeMapLocationEnabled: config.owner === 'mapkit',
      sharingEnabled: sharing, onIncomingSample: incoming });
    return null;
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(React.createElement(Probe, { active: true })); });
    expect(config.owner).toBe('mapkit'); expect(mockWatch).not.toHaveBeenCalled();
    await act(async () => { renderer.update(React.createElement(Probe, { active: false })); });
    expect(config).toEqual({ owner: 'expo', highAccuracy: false, powerMode: 'allDay' });
    expect(mockWatch).toHaveBeenCalledTimes(1);
    expect(mockWatch).toHaveBeenCalledWith(expect.any(Function), false, 'allDay');
    const sensor = require('../native').location.getCurrentLocation as jest.Mock;
    const pausedBootstrapReads = sensor.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(sensor).toHaveBeenCalledTimes(pausedBootstrapReads);
    expect(locationPolicy(config.highAccuracy, config.powerMode)).toMatchObject({ accuracy: 'low', distanceInterval: 150, timeInterval: 150_000 });
    const retiredSample = mockWatch.mock.calls[0][0] as (sample: unknown) => void;
    await act(async () => { renderer.update(React.createElement(Probe, { active: true })); });
    expect(mockStop).toHaveBeenCalledTimes(1); expect(config.owner).toBe('mapkit');
    retiredSample({ coordinates: { latitude: 25, longitude: 121 }, accuracy: 5, timestamp: Date.now() });
    expect(incoming).not.toHaveBeenCalled();
    await act(async () => { renderer.update(React.createElement(Probe, { active: false })); });
    await act(async () => { mockAppState.currentState = 'background'; mockAppListener('background'); });
    expect(config.owner).toBe('none'); expect(mockStop).toHaveBeenCalledTimes(2);
    await act(async () => { mockAppState.currentState = 'active'; mockAppListener('active'); });
    await act(async () => { renderer.update(React.createElement(Probe, { active: false, sharing: false })); });
    expect(config.owner).toBe('none'); expect(mockStop).toHaveBeenCalledTimes(3);
  } finally { await act(async () => renderer?.unmount()); jest.useRealTimers(); }
});
