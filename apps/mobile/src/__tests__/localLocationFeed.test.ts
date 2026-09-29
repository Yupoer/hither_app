jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'sample-id' }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
jest.mock('../native', () => ({ location: { getCurrentLocation: jest.fn(async () => null), watchLocation: jest.fn() } }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { increment: jest.fn(), event: jest.fn() } }));
jest.mock('../native/debugLocation', () => ({ isDebugRouteActive: () => false, subscribeDebugLocation: () => () => {} }));
jest.mock('../state/locationOutbox', () => ({ enqueueLocationOutbox: jest.fn(async () => {}), flushLocationOutbox: jest.fn(async () => {}) }));
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
import { enqueueLocationOutbox, flushLocationOutbox } from '../state/locationOutbox';
import { location } from '../native';

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

it('manual refresh requires this event to be accepted and passes precision to fresh GPS acquisition', async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  let feed!: ReturnType<typeof useDeviceLocation>;
  function Probe() { feed = useDeviceLocation({ groupId: 'g', highAccuracy: true, nativeMapLocationEnabled: true }); return null; }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  const sample = (timestamp: number) => ({ coordinates: { latitude: 25, longitude: 121 }, accuracy: 5, timestamp });
  (location.getCurrentLocation as jest.Mock).mockResolvedValueOnce(sample(Date.now()));
  (flushLocationOutbox as jest.Mock).mockResolvedValueOnce({ acceptedIds: [], remaining: 1 });
  await act(async () => { await expect(feed.refreshDeviceLocation({ requireUpload: true })).rejects.toThrow('location_upload_not_confirmed'); });
  expect(location.getCurrentLocation).toHaveBeenLastCalledWith(true, 'journey');
  (location.getCurrentLocation as jest.Mock).mockResolvedValueOnce(sample(Date.now() + 1));
  (flushLocationOutbox as jest.Mock).mockResolvedValueOnce({ acceptedIds: ['sample-id'], remaining: 0 });
  await act(async () => { await expect(feed.refreshDeviceLocation({ requireUpload: true })).resolves.toEqual({ latitude: 25, longitude: 121 }); });
  (location.getCurrentLocation as jest.Mock).mockResolvedValueOnce(sample(Date.now() + 1));
  await act(async () => { await expect(feed.refreshDeviceLocation({ requireUpload: true })).rejects.toThrow('no_new_location_sample'); });
  await act(async () => renderer.unmount());
  jest.useRealTimers();
});
