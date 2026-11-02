import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockAppState = { currentState: 'active' };
let mockAppListener: (state: string) => void;
const mockStop = jest.fn();
const mockWatch = jest.fn(async (_callback: unknown, _accuracy: unknown, _mode: unknown) => mockStop);
jest.mock('../api/supabase', () => ({ getLocalAuthActorId: jest.fn(async () => 'location-actor') }));
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

it('keeps one Expo owner across navigation and map blur, then stops at background or revoked consent', async () => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockAppState.currentState = 'active';
  let config!: ReturnType<typeof foregroundLocationConfiguration>;
  function Probe({ active, focused = true, sharing = true }: { active: boolean; focused?: boolean; sharing?: boolean }) {
    config = foregroundLocationConfiguration({ navigationActive: active,
      highAccuracy: true, sharingEnabled: sharing, hasMembership: true, appState: mockAppState.currentState });
    const feed = useDeviceLocation({ groupId: 'group', highAccuracy: config.highAccuracy, powerMode: config.powerMode,
      teamNavigationActive: active,
      sharingEnabled: sharing, hasMembership: true });
    return feed.lifecycle;
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(React.createElement(Probe, { active: true })); });
    expect(config.owner).toBe('expo');
    expect(mockWatch).toHaveBeenLastCalledWith(expect.any(Function), true, 'journey');
    await act(async () => { renderer.update(React.createElement(Probe, { active: false })); });
    expect(config).toEqual({ owner: 'expo', highAccuracy: false, powerMode: 'allDay' });
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockWatch).toHaveBeenCalledTimes(2);
    expect(locationPolicy(false, 'allDay')).toMatchObject({ accuracy: 'balanced', distanceInterval: 300, timeInterval: 300_000 });
    await act(async () => { renderer.update(React.createElement(Probe, { active: false, focused: false })); });
    expect(mockWatch).toHaveBeenCalledTimes(2);
    await act(async () => { mockAppState.currentState = 'inactive'; mockAppListener('inactive'); });
    expect(mockStop).toHaveBeenCalledTimes(1);
    await act(async () => { mockAppState.currentState = 'background'; mockAppListener('background'); });
    expect(config.owner).toBe('none');
    expect(mockStop).toHaveBeenCalledTimes(2);
    await act(async () => { mockAppState.currentState = 'active'; mockAppListener('active'); });
    expect(mockWatch).toHaveBeenCalledTimes(3);
    await act(async () => { renderer.update(React.createElement(Probe, { active: false, sharing: false })); });
    expect(config.owner).toBe('none');
    expect(mockStop).toHaveBeenCalledTimes(3);
  } finally { await act(async () => renderer?.unmount()); jest.useRealTimers(); }
});
