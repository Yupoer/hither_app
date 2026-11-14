import { d6TravelOrigin } from '../screens/MapScreen/d6TravelMode';
import { createElement } from 'react';
import { getTravelETA } from '../native/maps';
import { useD6TravelMode } from '../screens/MapScreen/hooks/useD6TravelMode';
import { majorityMotionMode, reconcileTravelOverride, resolveAutomaticTravelMode, type TravelOverride } from '../screens/MapScreen/d6TravelMode';

jest.mock('../native/location', () => ({ observeMotionTravelMode: () => () => undefined }));
jest.mock('../native/maps', () => ({ getTravelETA: jest.fn(async () => null) }));
jest.mock('../state/foregroundUi', () => ({ isForegroundUi: () => true, subscribeForegroundUi: () => () => undefined }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const override: TravelOverride = { lane: 'team-scoped', sessionId: null, mode: 'bicycle' };
const base = { distanceM: 900, override: null, majority: null, transitAvailable: false };

it('uses the leader override, then a majority of distinct members who reported movement', () => {
  const reports = [{ userId: 'a', mode: 'bicycle' }, { userId: 'b', mode: 'bicycle' }] satisfies Parameters<typeof majorityMotionMode>[1];
  expect(majorityMotionMode(3, [reports[0], reports[0]])).toBeNull();
  expect(majorityMotionMode(3, reports)).toBe('bicycle');
  expect(majorityMotionMode(4, reports)).toBeNull();
  expect(resolveAutomaticTravelMode({ ...base, majority: 'bicycle', override: 'walk' })).toBe('walk');
  expect(resolveAutomaticTravelMode({ ...base, majority: 'bicycle', remainingSeconds: 60 })).toBe('bicycle');
});

it('uses the meeting deadline before distance and only selects transit when MapKit confirmed an ETA', () => {
  expect(resolveAutomaticTravelMode({ ...base, walkETA: 420, remainingSeconds: 420 })).toBe('walk');
  expect(resolveAutomaticTravelMode({ ...base, walkETA: 421, remainingSeconds: 420, transitAvailable: true })).toBe('transit');
  expect(resolveAutomaticTravelMode({ ...base, walkETA: 421, remainingSeconds: 420 })).toBe('drive');
  expect(resolveAutomaticTravelMode({ ...base, distanceM: 1_000, transitAvailable: true })).toBe('walk');
  expect(resolveAutomaticTravelMode({ ...base, distanceM: 1_001 })).toBe('drive');
  expect(resolveAutomaticTravelMode({ ...base, distanceM: 15_000, transitAvailable: true })).toBe('transit');
  expect(resolveAutomaticTravelMode({ ...base, distanceM: 15_001, transitAvailable: true })).toBe('drive');
});

it('binds a pre-departure choice to the first session and clears it when the session or scope ends', () => {
  expect(reconcileTravelOverride(override, { lane: 'team-scoped', activeJourneyId: null })).toBe(override);
  const active = reconcileTravelOverride(override, { lane: 'team-scoped', activeJourneyId: 'session-one' });
  expect(active).toEqual({ ...override, sessionId: 'session-one' });
  expect(reconcileTravelOverride(active, { lane: 'team-scoped', activeJourneyId: undefined })).toBe(active);
  expect(reconcileTravelOverride(active, { lane: 'team-scoped', activeJourneyId: null })).toBeNull();
  expect(reconcileTravelOverride(active, { lane: 'team-scoped', activeJourneyId: 'session-two' })).toBeNull();
  expect(reconcileTravelOverride(active, { lane: 'another-team', activeJourneyId: 'session-one' })).toBeNull();
});

it('loads only the ETA it needs, fetches the other modes for details, and ignores an obsolete destination response', async () => {
  jest.useFakeTimers();
  const bridge = jest.mocked(getTravelETA);
  bridge.mockClear();
  let finishPreviousTravelETA: (seconds: number | null) => void = () => undefined;
  let finishRefreshTravelETA: (seconds: number | null) => void = () => undefined;
  let previousSignal: AbortSignal | undefined;
  let holdWalkRefresh = false;
  bridge.mockImplementation(({ to, travelMode, signal }) => {
    if (to.latitude === 25.02) {
      previousSignal = signal;
      return new Promise(resolve => { finishPreviousTravelETA = resolve; });
    }
    if (travelMode === 'walk') {
      if (holdWalkRefresh) return new Promise(resolve => { finishRefreshTravelETA = resolve; });
      return Promise.resolve(310);
    }
    if (travelMode === 'transit') return Promise.resolve(899);
    return Promise.resolve(null);
  });
  let state: ReturnType<typeof useD6TravelMode> | undefined;
  const origin = { latitude: 25, longitude: 121 };
  const initial: Parameters<typeof useD6TravelMode>[0] = {
    enabled: true, fallbackMode: 'walk',
    setFallbackMode: jest.fn(), canSetOverride: true, journeyKey: 'team', activeJourneyId: null,
    target: { id: 'first', coordinates: { latitude: 25.02, longitude: 121 } },
    memberCount: 2, selfUserId: 'a', sharingEnabled: true, origin, showModeEtas: false,
  };
  function Harness(input: Parameters<typeof useD6TravelMode>[0]) {
    state = useD6TravelMode(input);
    return state.lifecycle;
  }
  const input = { ...initial, target: { id: 'next', coordinates: { latitude: 25.004, longitude: 121 } } };
  let tree: ReturnType<typeof create>;
  try {
    await act(async () => { tree = create(createElement(Harness, initial)); });
    expect(state?.etaSeconds).toBeNull();
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(bridge.mock.calls.map(([call]) => call.travelMode)).toEqual(['transit']);
    await act(async () => { tree.update(createElement(Harness, input)); });
    expect(previousSignal?.aborted).toBe(true);
    await act(async () => { finishPreviousTravelETA(60); jest.advanceTimersByTime(500); });
    expect(state?.travelMode).toBe('walk');
    expect(state?.etaSeconds).toBe(310);
    await act(async () => { tree.update(createElement(Harness, { ...input, showModeEtas: true })); });
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(state?.etaByMode.transit).toBe(899);
    expect(state?.etaByMode.drive).toBeGreaterThan(0);
    holdWalkRefresh = true;
    await act(async () => { jest.advanceTimersByTime(135_000); });
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(state?.etaSeconds).toBe(310);
    await act(async () => { finishRefreshTravelETA(270); });
    expect(state?.etaSeconds).toBe(270);
    const lastCallCount = bridge.mock.calls.length;
    await act(async () => { tree.update(createElement(Harness, { ...initial, foreground: false })); });
    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(bridge.mock.calls).toHaveLength(lastCallCount);
  } finally {
    await act(async () => { tree?.unmount(); });
    jest.useRealTimers();
  }
});

it('uses a recent position for display ETA without requiring arrival precision or accepting stale samples', () => {
  const coordinates = { latitude: 25, longitude: 121 };
  expect(d6TravelOrigin({ coordinates, timestamp: 90_000 }, 100_000)).toBe(coordinates);
  expect(d6TravelOrigin({ coordinates, timestamp: 30_000 }, 100_000)).toBeUndefined();
  expect(d6TravelOrigin(null, 100_000)).toBeUndefined();
});
