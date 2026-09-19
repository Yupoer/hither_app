jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
jest.mock('../native', () => ({ location: { getCurrentLocation: jest.fn(async () => null), watchLocation: jest.fn() } }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { increment: jest.fn(), event: jest.fn() } }));
jest.mock('../native/debugLocation', () => ({ isDebugRouteActive: () => false, subscribeDebugLocation: () => () => {} }));
jest.mock('../state/locationOutbox', () => ({ enqueueLocationOutbox: jest.fn(async () => {}), flushLocationOutbox: jest.fn(async () => {}) }));
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
import { enqueueLocationOutbox } from '../state/locationOutbox';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('throttles normal UI projection, preserves fresh uploads, rejects old fixes, and stops on map blur', async () => {
  jest.useFakeTimers();
  let feed!: ReturnType<typeof useDeviceLocation>;
  const incoming = jest.fn();
  function Probe({ focused }: { focused: boolean }) {
    feed = useDeviceLocation({ groupId: focused ? 'g' : null, highAccuracy: false,
      nativeMapLocationEnabled: true, hasMembership: focused, onIncomingSample: incoming });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe, { focused: true })); });
  const sample = (latitude: number, timestamp: number) => ({ coordinates: { latitude, longitude: 121 }, accuracy: 5, timestamp });
  await act(async () => { feed.consumeForegroundSample(sample(25, 1000)); });
  // Normal journey/foreground projection is capped at 1 Hz and still filters
  // sub-jitter movement; the raw fix is accepted without a React update.
  await act(async () => { feed.consumeForegroundSample(sample(25.000001, 1001)); });
  expect(feed.deviceCoords?.latitude).toBe(25);
  expect(incoming).toHaveBeenCalledTimes(2);
  expect(incoming.mock.calls[1][0].coordinates.latitude).toBe(25.000001);
  jest.advanceTimersByTime(1_000);
  await act(async () => { feed.consumeForegroundSample(sample(25.0001, 2001)); });
  expect(feed.deviceCoords?.latitude).toBe(25.0001);
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
  await act(async () => { feed.consumeForegroundSample(sample(26, 999)); });
  expect(feed.deviceCoords?.latitude).toBe(25.0001);
  await act(async () => { renderer.update(React.createElement(Probe, { focused: false })); });
  await act(async () => { feed.consumeForegroundSample(sample(26, 1002)); });
  expect(feed.deviceCoords?.latitude).toBe(25.0001);
  await act(async () => renderer.unmount());
  jest.useRealTimers();
});
