import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { LocationSample } from '../native/location';
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
import { getLocalAuthActorId } from '../api/supabase';
import { captureLocationAccess, isLocationAccessEnabled } from '../state/locationPrivacy';
import { enqueueLocationOutbox, flushLocationOutbox } from '../state/locationOutbox';

const mockState = { currentState: 'active' };
const mockListeners = new Set<(state: string) => void>();
const mockRemove = jest.fn();
const mockWatch = jest.fn<Promise<() => void>, [(sample: LocationSample) => void, boolean, string]>();
const mockRead = jest.fn<Promise<LocationSample | null>, [boolean, string]>();
let mockDebug: (sample: LocationSample) => void;
jest.mock('../api/supabase', () => ({ getLocalAuthActorId: jest.fn(async () => 'location-actor') }));
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
  jest.mocked(getLocalAuthActorId).mockResolvedValue('location-actor');
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


it('waits for the watcher event ACK when a pending refresh receives the same fresh fix', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const incoming = jest.fn();
  await act(async () => { tree = create(React.createElement(Probe, { incoming })); });
  let finishFix!: (fix: LocationSample) => void;
  let finishUpload!: (result: { acceptedIds: string[] }) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const flush = jest.mocked(flushLocationOutbox);
  flush.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve as typeof finishUpload; }));
  let resolved = false;
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true }).then(value => { resolved = true; return value; });
  await act(async () => {});
  const fix = sample(26);
  await act(async () => { mockWatch.mock.calls[0][0](fix); });
  await act(async () => { finishFix({ ...fix, coordinates: { ...fix.coordinates } }); });
  expect(resolved).toBe(false);
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
  expect(incoming).toHaveBeenCalledTimes(1);
  await act(async () => { finishUpload({ acceptedIds: ['location-sample'] }); });
  await expect(refresh).resolves.toEqual(fix.coordinates);
});

it('keeps required-upload failure when the shared watcher event is not acknowledged', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe)); });
  let finishFix!: (fix: LocationSample) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  const rejection = expect(refresh).rejects.toThrow('location_upload_not_confirmed');
  await act(async () => {});
  jest.mocked(flushLocationOutbox).mockResolvedValueOnce({ acceptedIds: [], remaining: 1 } as never);
  const fix = sample(26);
  await act(async () => { mockWatch.mock.calls[0][0](fix); });
  await act(async () => { finishFix(fix); });
  await rejection;
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
});

it('forces an upload when the fresh watcher sample was below its normal upload gate', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe)); });
  await act(async () => { mockWatch.mock.calls[0][0](sample()); });
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
  let finishFix!: (fix: LocationSample) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  await act(async () => {});
  const fix = { ...sample(), timestamp: Date.now() + 1 };
  await act(async () => { mockWatch.mock.calls[0][0](fix); });
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
  await act(async () => { finishFix(fix); });
  await expect(refresh).resolves.toEqual(fix.coordinates);
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(2);
});

it.each(['group', 'sharing', 'unmount'] as const)('fences a shared upload completion after %s changes', async changed => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe)); });
  let finishFix!: (fix: LocationSample) => void;
  let finishUpload!: (result: { acceptedIds: string[] }) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  jest.mocked(flushLocationOutbox).mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve as typeof finishUpload; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  await act(async () => {});
  const fix = sample(26);
  await act(async () => { mockWatch.mock.calls[0][0](fix); });
  await act(async () => { finishFix(fix); });
  await act(async () => {
    if (changed === 'unmount') { tree!.unmount(); tree = undefined; }
    else tree!.update(React.createElement(Probe, changed === 'group' ? { group: 'group-b' } : { sharing: false }));
  });
  await act(async () => { finishUpload({ acceptedIds: ['location-sample'] }); });
  await expect(refresh).resolves.toBeNull();
});

it('rejects a different fix with the same timestamp as the watcher sample', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe)); });
  let finishFix!: (fix: LocationSample) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  const rejection = expect(refresh).rejects.toThrow('no_new_location_sample');
  await act(async () => {});
  const fix = sample(26);
  await act(async () => { mockWatch.mock.calls[0][0](fix); });
  await act(async () => { finishFix({ ...fix, coordinates: { latitude: 27, longitude: 121 } }); });
  await rejection;
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
});


it('preserves refresh when the local actor remains unavailable', async () => {
  jest.mocked(getLocalAuthActorId).mockResolvedValue(null);
  const probe = createLocationProbe();
  const { Probe } = probe;
  await act(async () => { tree = create(React.createElement(Probe)); });
  const fix = sample(26);
  mockRead.mockResolvedValueOnce(fix);
  await act(async () => { await expect(probe.feed.refreshDeviceLocation({ requireUpload: true })).resolves.toEqual(fix.coordinates); });
});

it('discards a one-shot result before raw acceptance when the account changes during GPS', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const incoming = jest.fn();
  await act(async () => { tree = create(React.createElement(Probe, { incoming })); });
  let finishFix!: (fix: LocationSample) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  await act(async () => {});
  jest.mocked(getLocalAuthActorId).mockResolvedValue('replacement-actor');
  await act(async () => { finishFix(sample(26)); });
  await expect(refresh).resolves.toBeNull();
  expect(incoming).not.toHaveBeenCalled();
  expect(enqueueLocationOutbox).not.toHaveBeenCalled();
});


it('returns the newer watcher fix instead of an earlier one-shot fix without rolling back the UI', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  const incoming = jest.fn();
  await act(async () => { tree = create(React.createElement(Probe, { incoming })); });
  let finishFix!: (fix: LocationSample) => void;
  mockRead.mockImplementationOnce(() => new Promise(resolve => { finishFix = resolve; }));
  const refresh = probe.feed.refreshDeviceLocation({ requireUpload: true });
  await act(async () => {});
  const first = sample(26);
  const newer = { ...sample(27), timestamp: Date.now() + 1 };
  await act(async () => { mockWatch.mock.calls[0][0](first); mockWatch.mock.calls[0][0](newer); });
  await act(async () => { finishFix(first); });
  await expect(refresh).resolves.toEqual(newer.coordinates);
  expect(probe.feed.deviceCoords).toEqual(newer.coordinates);
  expect(incoming).toHaveBeenCalledTimes(2);
  expect(enqueueLocationOutbox).toHaveBeenLastCalledWith(expect.objectContaining({ coordinates: { ...newer.coordinates, accuracy: 5 }, capturedAt: newer.timestamp }));
});

it('recovers manual GPS after failed watcher setup and failed automatic reads', async () => {
  const probe = createLocationProbe();
  const { Probe } = probe;
  mockWatch.mockRejectedValueOnce(new Error('native_watch_failed'));
  mockRead.mockRejectedValueOnce(new Error('bootstrap_fix_failed'));
  mockRead.mockRejectedValueOnce(new Error('watchdog_fix_failed'));
  jest.mocked(flushLocationOutbox).mockRejectedValueOnce(new Error('initial_flush_failed'));
  await act(async () => { tree = create(React.createElement(Probe)); });
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  mockRead.mockResolvedValueOnce(sample(26));
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
  expect(probe.feed.deviceCoords).toEqual({ latitude: 26, longitude: 121 });
  expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
});
