import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { LocationSample } from '../native/location';
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
import { captureLocationAccess, isLocationAccessEnabled } from '../state/locationPrivacy';
import { enqueueLocationOutbox } from '../state/locationOutbox';

const mockState = { currentState: 'active' };
const mockListeners = new Set<(state: string) => void>();
const mockRemove = jest.fn();
const mockWatch = jest.fn<Promise<() => void>, [(sample: LocationSample) => void, boolean, string]>();
const mockRead = jest.fn<Promise<LocationSample | null>, [boolean, string]>();
let mockDebug: (sample: LocationSample) => void;
jest.mock('react-native', () => ({ AppState: {
  get currentState() { return mockState.currentState; },
  addEventListener: (_event: string, listener: (state: string) => void) => {
    mockListeners.add(listener);
    return { remove() { mockRemove(); mockListeners.delete(listener); } };
  },
} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'location-sample' }));
jest.mock('../native', () => ({ location: {
  watchLocation: (...args: Parameters<typeof mockWatch>) => mockWatch(...args),
  getCurrentLocation: (...args: Parameters<typeof mockRead>) => mockRead(...args),
} }));
jest.mock('../native/debugLocation', () => ({ isDebugRouteActive: () => true,
  subscribeDebugLocation: (listener: typeof mockDebug) => { mockDebug = listener; return () => {}; } }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { increment() {}, event() {} } }));
jest.mock('../state/locationOutbox', () => ({ enqueueLocationOutbox: jest.fn(async () => {}),
  flushLocationOutbox: jest.fn(async () => ({ acceptedIds: ['location-sample'] })) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sample = (latitude = 25): LocationSample => ({
  coordinates: { latitude, longitude: 121 }, timestamp: Date.now(), accuracy: 5,
});
function createLocationProbe() {
let feed!: ReturnType<typeof useDeviceLocation>;
function Probe({ group = 'group-a', sharing = true, nativeMap = false, passive = false,
  highAccuracy = false, incoming }: { group?: string; sharing?: boolean; nativeMap?: boolean;
  passive?: boolean; highAccuracy?: boolean; incoming?: (sample: LocationSample, now: number) => void }) {
  feed = useDeviceLocation({ groupId: group, highAccuracy, powerMode: passive ? 'allDay' : 'journey',
    nativeMapLocationEnabled: nativeMap, sharingEnabled: sharing, hasMembership: true, onIncomingSample: incoming });
  return feed.lifecycle;
}
  return { Probe, get feed() { return feed; } };
}
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  jest.clearAllMocks(); mockState.currentState = 'active'; mockListeners.clear();
  mockRead.mockResolvedValue(null); mockWatch.mockImplementation(async () => () => {});
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); }); tree = undefined;
  jest.useRealTimers();
});

it('publishes privacy before a synchronous first watch sample and keeps UI through profile resets', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const callback = jest.fn(); const stop = jest.fn();
  mockWatch.mockImplementationOnce(async accept => {
    expect(isLocationAccessEnabled()).toBe(true);
    accept(sample());
    return stop;
  });
  await act(async () => { tree = create(React.createElement(Probe, { incoming: callback })); });
  expect(probe.feed.deviceCoords).toEqual({ latitude: 25, longitude: 121 });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(enqueueLocationOutbox).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-a' }));
  const acceptedAt = probe.feed.deviceCoordsAcceptedAtMs;
  await act(async () => { tree!.update(React.createElement(Probe, { highAccuracy: true, incoming: callback })); });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(probe.feed.deviceCoords).toEqual({ latitude: 25, longitude: 121 });
  expect(probe.feed.deviceAccuracyM).toBe(5);
  expect(probe.feed.deviceCoordsAcceptedAtMs).toBe(acceptedAt);
  await act(async () => { tree!.update(React.createElement(Probe, { sharing: false })); });
  expect(isLocationAccessEnabled()).toBe(false);
  expect(mockWatch).toHaveBeenCalledTimes(2);
});

it('releases a late watch Promise and fences its callback after group/source replacement', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  let finish!: (stop: () => void) => void;
  let oldAccept!: (sample: LocationSample) => void;
  mockWatch.mockImplementationOnce(accept => { oldAccept = accept; return new Promise(resolve => { finish = resolve; }); });
  await act(async () => { tree = create(React.createElement(Probe)); });
  await act(async () => { tree!.update(React.createElement(Probe, { group: 'group-b', nativeMap: true })); });
  expect(mockWatch).toHaveBeenCalledTimes(1);
  const lateStop = jest.fn();
  await act(async () => { finish(lateStop); oldAccept(sample(26)); });
  expect(lateStop).toHaveBeenCalledTimes(1);
  expect(probe.feed.deviceCoords).toBeNull();
  expect(await captureLocationAccess('group-a')).toBeNull();
  expect(await captureLocationAccess('group-b')).not.toBeNull();
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(isLocationAccessEnabled()).toBe(false);
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

it('runs the real watchdog only outside allDay and never retimestamps a cached sample', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe, { passive: true, nativeMap: true })); });
  const bootstrapReads = mockRead.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(120_000); });
  expect(mockRead).toHaveBeenCalledTimes(bootstrapReads);
  await act(async () => { probe.feed.consumeForegroundSample(sample()); });
  const acceptedAt = probe.feed.deviceCoordsAcceptedAtMs;
  await act(async () => { tree!.update(React.createElement(Probe, { passive: false, nativeMap: true })); });
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(mockRead).toHaveBeenCalledTimes(bootstrapReads + 1);
  expect(mockRead).toHaveBeenLastCalledWith(false, 'journey');
  expect(probe.feed.deviceCoordsAcceptedAtMs).toBe(acceptedAt);
  expect(mockWatch).not.toHaveBeenCalled();
});

it('keeps debug fixes local and publishes the latest incoming callback without restarting the source', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const first = jest.fn(); const latest = jest.fn();
  await act(async () => { tree = create(React.createElement(Probe, { incoming: first })); });
  await act(async () => { tree!.update(React.createElement(Probe, { incoming: latest })); });
  expect(mockWatch).toHaveBeenCalledTimes(1);
  await act(async () => { mockDebug(sample(26)); });
  expect(probe.feed.deviceCoords?.latitude).toBe(26);
  expect(enqueueLocationOutbox).not.toHaveBeenCalled();
  await act(async () => { mockWatch.mock.calls[0][0](sample(27)); });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

it('replays Strict setup with one surviving source and clears privacy only on actual owner disposal', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const stops: jest.Mock[] = [];
  mockWatch.mockImplementation(async () => { const stop = jest.fn(); stops.push(stop); return stop; });
  await act(async () => { tree = create(React.createElement(React.StrictMode, null, React.createElement(Probe))); });
  expect(mockWatch).toHaveBeenCalledTimes(2);
  expect(stops[0]).toHaveBeenCalledTimes(1);
  expect(stops[1]).not.toHaveBeenCalled();
  expect(isLocationAccessEnabled()).toBe(true);
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(stops[1]).toHaveBeenCalledTimes(1);
  expect(isLocationAccessEnabled()).toBe(false);
});
