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

it('feeds small successive GPS moves immediately, rejects old fixes, and stops accepting on map blur', async () => {
  jest.useFakeTimers();
  let feed!: ReturnType<typeof useDeviceLocation>;
  function Probe({ focused }: { focused: boolean }) {
    feed = useDeviceLocation({ groupId: focused ? 'g' : null, highAccuracy: false,
      nativeMapLocationEnabled: true, hasMembership: focused });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe, { focused: true })); });
  const sample = (latitude: number, timestamp: number) => ({ coordinates: { latitude, longitude: 121 }, accuracy: 5, timestamp });
  await act(async () => { feed.consumeForegroundSample(sample(25, 1000)); });
  await act(async () => { feed.consumeForegroundSample(sample(25.000001, 1001)); });
  expect(feed.deviceCoords?.latitude).toBe(25.000001);
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
  await act(async () => { feed.consumeForegroundSample(sample(26, 999)); });
  expect(feed.deviceCoords?.latitude).toBe(25.000001);
  await act(async () => { renderer.update(React.createElement(Probe, { focused: false })); });
  await act(async () => { feed.consumeForegroundSample(sample(26, 1002)); });
  expect(feed.deviceCoords?.latitude).toBe(25.000001);
  await act(async () => renderer.unmount());
  jest.useRealTimers();
});
