import { backgroundLocationOptions } from '../state/backgroundJourneyController';
import {
  createMotionState,
  locationPolicy,
  POWER_BUDGET_NOTE,
  quantizeCoordinates,
  reduceMotionState,
  resolveTrackingMode,
  shouldAcceptUiSample,
  shouldRecomputeRoute,
  shouldRunBackgroundLocation,
  shouldUploadSample,
  shouldWatchLocation,
  uploadHeartbeatForCadence,
  type LocationGateState,
} from '../utils/locationPolicy';
import type { Coordinates } from '../types';

const origin: Coordinates = { latitude: 25.04, longitude: 121.5 };

/** ~move meters east of origin (rough; enough for gate tests). */
function moved(metersEast: number): Coordinates {
  // 1 deg lon ≈ 111_320 * cos(lat) m; at 25° ≈ 100_800 m
  return {
    latitude: origin.latitude,
    longitude: origin.longitude + metersEast / 100_800,
  };
}

const empty: LocationGateState = { lastCoords: null, lastAtMs: 0 };
const atOrigin = (atMs: number): LocationGateState => ({
  lastCoords: origin,
  lastAtMs: atMs,
});

describe('locationPolicy', () => {
  it('defaults to the motion-aware foreground balanced profile', () => {
    const p = locationPolicy(false);
    expect(p.accuracy).toBe('balanced');
    expect(p.distanceInterval).toBe(30);
    expect(p.timeInterval).toBe(15_000);
    expect(p.uploadMinDistanceM).toBe(30);
    expect(p.uploadHeartbeatMs).toBe(45_000);
    expect(p.uploadHeartbeatStationaryMs).toBe(90_000);
    expect(p.stationaryAfterMs).toBe(60_000);
    expect(p.uploadHeartbeatStationaryMs).toBeGreaterThan(p.uploadHeartbeatMs);
    expect(p.routeCoordDecimals).toBe(4);
    expect(p.realtimeLocationDebounceMs).toBe(2_500);
  });

  it('uses the faster high-accuracy profile only when enabled in foreground', () => {
    const p = locationPolicy(true);
    expect(p.accuracy).toBe('high');
    expect(p.distanceInterval).toBe(8);
    expect(p.timeInterval).toBe(5_000);
    expect(p.uploadMinDistanceM).toBe(12);
    expect(p.uploadHeartbeatMs).toBe(20_000);
    expect(p.uploadHeartbeatStationaryMs).toBe(60_000);
    expect(p.routeCoordDecimals).toBe(5);
    expect(p.realtimeLocationDebounceMs).toBe(1_500);
  });

  it('allDay ignores highAccuracy and uses Low GPS for the 8h budget', () => {
    const p = locationPolicy(true, 'allDay');
    expect(p.accuracy).toBe('low');
    expect(p.distanceInterval).toBe(120);
    expect(p.uploadHeartbeatMs).toBe(180_000);
    expect(p.uploadHeartbeatStationaryMs).toBe(300_000);
    expect(p.uploadMinDistanceM).toBe(120);
    expect(POWER_BUDGET_NOTE.allDay8hTargetPct).toBe(20);
  });

  it('journey balanced is denser than allDay but not High', () => {
    const p = locationPolicy(false, 'journey');
    expect(p.accuracy).toBe('balanced');
    expect(p.uploadHeartbeatMs).toBeLessThan(locationPolicy(false, 'allDay').uploadHeartbeatMs);
  });

  it('uses fitness High accuracy for walking team navigation', () => {
    expect(backgroundLocationOptions('journey', false, 'teamNavigation')).toMatchObject({
      accuracy: 4,
      activityType: 3,
      pausesUpdatesAutomatically: true,
      deferredUpdatesDistance: 30,
      deferredUpdatesInterval: 30_000,
    });
  });

  it('never promotes manual walking precision to BestForNavigation', () => {
    expect(backgroundLocationOptions('journey', true, 'navigationMax')).toMatchObject({
      accuracy: 5,
      activityType: 3,
      pausesUpdatesAutomatically: true,
    });
  });
});

describe('motion cadence', () => {
  const policy = locationPolicy(false);

  it('starts moving and stays moving while significantly relocating', () => {
    let state = createMotionState(1_000);
    state = reduceMotionState(state, origin, 1_000, policy);
    expect(state.cadence).toBe('moving');
    state = reduceMotionState(state, moved(40), 10_000, policy);
    expect(state.cadence).toBe('moving');
  });

  it('becomes stationary after a quiet span without significant move', () => {
    let state = createMotionState(1_000);
    state = reduceMotionState(state, origin, 1_000, policy);
    state = reduceMotionState(
      state,
      moved(2),
      1_000 + policy.stationaryAfterMs,
      policy,
    );
    expect(state.cadence).toBe('stationary');
  });

  it('returns to moving on a significant move after rest', () => {
    let state = createMotionState(1_000);
    state = reduceMotionState(state, origin, 1_000, policy);
    state = reduceMotionState(
      state,
      moved(1),
      1_000 + policy.stationaryAfterMs + 1_000,
      policy,
    );
    expect(state.cadence).toBe('stationary');
    state = reduceMotionState(
      state,
      moved(50),
      1_000 + policy.stationaryAfterMs + 2_000,
      policy,
    );
    expect(state.cadence).toBe('moving');
  });

  it('picks denser heartbeat while moving and calmer while stationary', () => {
    expect(uploadHeartbeatForCadence(policy, 'moving')).toBe(policy.uploadHeartbeatMs);
    expect(uploadHeartbeatForCadence(policy, 'stationary')).toBe(
      policy.uploadHeartbeatStationaryMs,
    );
  });
});

describe('resolveTrackingMode', () => {
  const base = {
    teamNavigationActive: false,
    manualHighAccuracy: false,
    appState: 'background' as const,
  };

  it('gives privacy mode precedence over every accuracy request', () => {
    expect(
      resolveTrackingMode({
        ...base,
        sharingEnabled: false,
        teamNavigationActive: true,
        manualHighAccuracy: true,
      }),
    ).toBe('hidden');
  });

  it('escalates navigation only when the team session is active', () => {
    expect(
      resolveTrackingMode({
        ...base,
        sharingEnabled: true,
        teamNavigationActive: true,
        manualHighAccuracy: false,
      }),
    ).toBe('teamNavigation');
    expect(
      resolveTrackingMode({
        ...base,
        sharingEnabled: true,
        teamNavigationActive: true,
        manualHighAccuracy: true,
      }),
    ).toBe('navigationMax');
  });

  it('uses foreground/passive modes when navigation is inactive', () => {
    expect(
      resolveTrackingMode({ ...base, sharingEnabled: true }),
    ).toBe('passiveBackground');
    expect(
      resolveTrackingMode({
        ...base,
        appState: 'active',
        sharingEnabled: true,
      }),
    ).toBe('foreground');
    expect(
      resolveTrackingMode({
        ...base,
        sharingEnabled: true,
        manualHighAccuracy: true,
      }),
    ).toBe('manualHighAccuracy');
  });
});

describe('shouldWatchLocation / shouldRunBackgroundLocation', () => {
  it('splits GPS ownership: FG watch only when active', () => {
    expect(shouldWatchLocation('group-1', 'active')).toBe(true);
    expect(shouldWatchLocation('group-1', 'background')).toBe(false);
    expect(shouldWatchLocation(null, 'active')).toBe(false);

    expect(shouldRunBackgroundLocation('group-1', 'background')).toBe(true);
    expect(shouldRunBackgroundLocation('group-1', 'active')).toBe(false);
    expect(shouldRunBackgroundLocation(null, 'background')).toBe(false);
  });
});

describe('shouldAcceptUiSample', () => {
  const policy = locationPolicy(false);

  it('accepts the first sample', () => {
    expect(shouldAcceptUiSample(origin, 1_000, empty, policy)).toBe(true);
  });

  it('accepts a meaningful move past uiMinDistanceM', () => {
    expect(shouldAcceptUiSample(moved(20), 2_000, atOrigin(1_000), policy)).toBe(true);
  });

  it('drops jitter within uiMinIntervalMs', () => {
    expect(shouldAcceptUiSample(moved(2), 1_500, atOrigin(1_000), policy)).toBe(false);
  });

  it('drops near-stationary samples even after the interval', () => {
    expect(
      shouldAcceptUiSample(moved(1), 1_000 + policy.uiMinIntervalMs + 100, atOrigin(1_000), policy),
    ).toBe(false);
  });
});

describe('shouldUploadSample', () => {
  const policy = locationPolicy(false);

  it('accepts the first sample', () => {
    expect(shouldUploadSample(origin, 1_000, empty, policy)).toBe(true);
  });

  it('uploads after a large enough move and min interval', () => {
    expect(
      shouldUploadSample(
        moved(55),
        1_000 + policy.uploadMinIntervalMs,
        atOrigin(1_000),
        policy,
      ),
    ).toBe(true);
  });

  it('does not upload tiny moves before heartbeat', () => {
    expect(
      shouldUploadSample(moved(5), 1_000 + 10_000, atOrigin(1_000), policy),
    ).toBe(false);
  });

  it('uploads on moving heartbeat while nearly stationary', () => {
    expect(
      shouldUploadSample(
        moved(1),
        1_000 + policy.uploadHeartbeatMs,
        atOrigin(1_000),
        policy,
        'moving',
      ),
    ).toBe(true);
  });

  it('waits longer for heartbeat while stationary', () => {
    expect(
      shouldUploadSample(
        moved(1),
        1_000 + policy.uploadHeartbeatMs,
        atOrigin(1_000),
        policy,
        'stationary',
      ),
    ).toBe(false);
    expect(
      shouldUploadSample(
        moved(1),
        1_000 + policy.uploadHeartbeatStationaryMs,
        atOrigin(1_000),
        policy,
        'stationary',
      ),
    ).toBe(true);
  });
});

describe('shouldRecomputeRoute', () => {
  const policy = locationPolicy(false);

  it('recomputes on first sample', () => {
    expect(shouldRecomputeRoute(origin, 1_000, empty, policy)).toBe(true);
  });

  it('skips small moves', () => {
    expect(shouldRecomputeRoute(moved(5), 5_000, atOrigin(1_000), policy)).toBe(false);
  });

  it('recomputes after enough move past partial interval', () => {
    expect(
      shouldRecomputeRoute(
        moved(50),
        1_000 + policy.routeMinIntervalMs * 0.5,
        atOrigin(1_000),
        policy,
      ),
    ).toBe(true);
  });
});

describe('quantizeCoordinates', () => {
  it('rounds to the requested decimals', () => {
    expect(quantizeCoordinates({ latitude: 25.123456, longitude: 121.987654 }, 4)).toBe(
      '25.1235:121.9877',
    );
  });
});
