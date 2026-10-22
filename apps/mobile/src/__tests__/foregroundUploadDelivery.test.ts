jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'sample-id' }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mockAppState = {
  currentState: 'active',
  listeners: new Set<(state: string) => void>(),
  addEventListener(_type: string, listener: (state: string) => void) {
    mockAppState.listeners.add(listener);
    return { remove: () => { mockAppState.listeners.delete(listener); } };
  },
};
jest.mock('react-native', () => ({ AppState: mockAppState }));
jest.mock('../native', () => ({ location: { getCurrentLocation: jest.fn(async () => null), watchLocation: jest.fn() } }));
jest.mock('../state/energyObservability', () => ({ energyObservability: { increment: jest.fn(), event: jest.fn() } }));
jest.mock('../native/debugLocation', () => ({ isDebugRouteActive: () => false, subscribeDebugLocation: () => () => {} }));
jest.mock('../state/locationOutbox', () => ({
  enqueueLocationOutbox: jest.fn(async () => {}),
  flushLocationOutbox: jest.fn(async () => ({ acceptedIds: ['sample-id'], remaining: 0 })),
}));
import { useDeviceLocation } from '../screens/MapScreen/hooks/useDeviceLocation';
import { enqueueLocationOutbox, flushLocationOutbox } from '../state/locationOutbox';
import type { LocationPowerMode } from '../utils/locationPolicy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flushOutbox = flushLocationOutbox as jest.Mock;
const sample = (timestamp: number) => ({ coordinates: { latitude: 25, longitude: 121 }, accuracy: 5, timestamp });

async function mountWith(powerMode: LocationPowerMode) {
  let feed!: ReturnType<typeof useDeviceLocation>;
  function Probe({ sharingEnabled }: { sharingEnabled: boolean }) {
    feed = useDeviceLocation({ groupId: 'g', highAccuracy: false, powerMode, sharingEnabled,
      teamNavigationActive: powerMode === 'journey', nativeMapLocationEnabled: true, hasMembership: true });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Probe, { sharingEnabled: true })); });
  return {
    renderer,
    consume: (at: number) => feed.consumeForegroundSample(sample(at)),
    setSharing: (sharingEnabled: boolean) => act(async () => {
      renderer.update(React.createElement(Probe, { sharingEnabled }));
    }),
  };
}

async function moveAppTo(state: string) {
  mockAppState.currentState = state;
  await act(async () => { mockAppState.listeners.forEach(listener => listener(state)); });
}

async function settle() {
  await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
}

describe('foreground location upload delivery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAppState.currentState = 'active';
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('flushes each accepted fix immediately during a journey so peers see it live', async () => {
    const { renderer, consume } = await mountWith('journey');
    const before = flushOutbox.mock.calls.length;
    await act(async () => { consume(Date.now()); });
    await settle();
    expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
    expect(flushOutbox.mock.calls.length).toBe(before + 1);
    await act(async () => renderer.unmount());
  });

  it('batches fixes through the delayed outbox flush when not navigating', async () => {
    const { renderer, consume } = await mountWith('allDay');
    const before = flushOutbox.mock.calls.length;
    await act(async () => { consume(Date.now()); });
    await settle();
    expect(enqueueLocationOutbox).toHaveBeenCalledTimes(1);
    expect(flushOutbox.mock.calls.length).toBe(before);
    await act(async () => { jest.advanceTimersByTime(20_000); });
    await settle();
    expect(flushOutbox.mock.calls.length).toBe(before + 1);
    await act(async () => renderer.unmount());
  });

  it('hands a queued fix to an immediate flush when the app backgrounds before the batch deadline', async () => {
    const { renderer, consume } = await mountWith('allDay');
    await act(async () => { consume(Date.now()); });
    await settle();
    const before = flushOutbox.mock.calls.length;
    await moveAppTo('background');
    await settle();
    expect(flushOutbox.mock.calls.length).toBe(before + 1);
    await act(async () => { jest.advanceTimersByTime(120_000); });
    await settle();
    expect(flushOutbox.mock.calls.length).toBe(before + 1);
    await act(async () => renderer.unmount());
  });

  it('hands a queued fix to an immediate flush when the map owner unmounts before the batch deadline', async () => {
    const { renderer, consume } = await mountWith('allDay');
    await act(async () => { consume(Date.now()); });
    await settle();
    const before = flushOutbox.mock.calls.length;
    await act(async () => renderer.unmount());
    await settle();
    expect(flushOutbox.mock.calls.length).toBe(before + 1);
  });

  it('drops the pending batch flush without sending when sharing is turned off before the deadline', async () => {
    const { renderer, consume, setSharing } = await mountWith('allDay');
    await act(async () => { consume(Date.now()); });
    await settle();
    const before = flushOutbox.mock.calls.length;
    await setSharing(false);
    await act(async () => { jest.advanceTimersByTime(120_000); });
    await settle();
    expect(flushOutbox.mock.calls.length).toBe(before);
    await act(async () => renderer.unmount());
  });
});
