import { backgroundLocationOptions } from '../state/backgroundJourneyController';
import {
  createMotionState,
  locationPolicy,
  syncTimingScale,
  routeLocationPolicy,
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
  it.each([
    [true, 'journey', false, 'high', 15_000, 10, 15_000, 180_000],
    [false, 'journey', false, 'high', 60_000, 100, 90_000, 360_000],
    [true, 'allDay', false, 'balanced', 300_000, 300, 300_000, 300_000],
    [false, 'foreground', false, 'balanced', 300_000, 300, 300_000, 300_000],
    [false, 'allDay', true, 'balanced', 600_000, 300, 600_000, 600_000],
  ] as const)('uses canonical sharing cadence %s/%s/background%s', (precise, mode, background, accuracy, interval, distance, moving, stationary) => {
    expect(locationPolicy(precise, mode, background)).toMatchObject({ accuracy, timeInterval: interval,
      distanceInterval: distance, uploadMinIntervalMs: interval, uploadMinDistanceM: distance,
      uploadHeartbeatMs: moving, uploadHeartbeatStationaryMs: stationary });
  });
  it('uses ordinary High and Other activity for both journey precision modes', () => {
    for (const mode of ['teamNavigation', 'navigationMax'] as const) {
      expect(backgroundLocationOptions('journey', mode === 'navigationMax', mode)).toMatchObject({
        accuracy: 4, activityType: 1, showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false, deferredUpdatesDistance: 0, deferredUpdatesInterval: 0 });
    }
  });
  it('requests passive background at ten minutes without pausing', () => {
    expect(backgroundLocationOptions('allDay', true, 'passiveBackground')).toMatchObject({
      accuracy: 3, activityType: 1, timeInterval: 600_000, distanceInterval: 300,
      deferredUpdatesDistance: 300, deferredUpdatesInterval: 600_000,
      pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: false });
  });
});

describe('motion cadence', () => {
  const policy = locationPolicy(false, 'journey');

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
      moved(policy.uploadMinDistanceM + 5),
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
    ).toBe('passiveBackground');
  });
});

describe('shouldWatchLocation / shouldRunBackgroundLocation', () => {
  it('keeps foreground GPS under system covers and transfers ownership only in background', () => {
    expect(shouldWatchLocation('group-1', 'active')).toBe(true);
    expect(shouldWatchLocation('group-1', 'inactive')).toBe(true);
    expect(shouldRunBackgroundLocation('group-1', 'inactive')).toBe(false);
    expect(shouldRunBackgroundLocation('group-1', 'unknown')).toBe(false);
    expect(shouldWatchLocation('group-1', 'background')).toBe(false);
    expect(shouldWatchLocation(null, 'active')).toBe(false);

    expect(shouldRunBackgroundLocation('group-1', 'background')).toBe(true);
    expect(shouldRunBackgroundLocation('group-1', 'active')).toBe(false);
    expect(shouldRunBackgroundLocation(null, 'background')).toBe(false);
  });

  it('stops GPS when sharing is off or the account has no memberships (#196 D4)', () => {
    expect(shouldWatchLocation('group-1', 'active', false, true)).toBe(false);
    expect(shouldWatchLocation('group-1', 'active', true, false)).toBe(false);
    expect(shouldRunBackgroundLocation('group-1', 'background', false, true)).toBe(false);
    expect(shouldRunBackgroundLocation('group-1', 'background', true, false)).toBe(false);
  });

  it('journey targets 60s minimum and 90s/360s heartbeats with real samples', () => {
    const p = locationPolicy(false, 'journey');
    expect(p.uploadMinIntervalMs).toBe(60_000);
    expect(p.uploadHeartbeatMs).toBe(90_000);
    expect(p.uploadHeartbeatStationaryMs).toBe(360_000);
  });

  it('precise journey keeps the explicit 15-second floor', () => {
    const p = locationPolicy(true, 'journey');
    expect(p.uploadMinIntervalMs).toBe(15_000);
    expect(p.uploadHeartbeatMs).toBe(15_000);
    expect(p.uploadHeartbeatStationaryMs).toBe(180_000);
    expect(p.uiMinIntervalMs).toBe(500);
  });

  it('idle heartbeats respect the five-minute sharing minimum', () => {
    const allDay = locationPolicy(false, 'allDay');
    const fg = locationPolicy(false, 'foreground');
    expect(allDay.uploadHeartbeatMs).toBe(300_000);
    expect(allDay.uploadHeartbeatStationaryMs).toBe(300_000);
    expect(fg.uploadHeartbeatStationaryMs).toBe(300_000);
  });

  it('same-coord heartbeat still uploads so updated_at moves', () => {
    const policy = locationPolicy(false, 'allDay');
    expect(
      shouldUploadSample(origin, 1_000 + policy.uploadHeartbeatMs, atOrigin(1_000), policy),
    ).toBe(true);
  });
});

describe('shouldAcceptUiSample', () => {
  const policy = locationPolicy(false, 'journey');

  it('accepts the first sample', () => {
    expect(shouldAcceptUiSample(origin, 1_000, empty, policy)).toBe(true);
  });

  it('accepts a meaningful move past uiMinDistanceM', () => {
    expect(shouldAcceptUiSample(moved(policy.uiMinDistanceM + 5), 1_000 + policy.uiMinIntervalMs, atOrigin(1_000), policy)).toBe(true);
  });

  it('drops jitter within uiMinIntervalMs', () => {
    expect(shouldAcceptUiSample(moved(2), 1_500, atOrigin(1_000), policy)).toBe(false);
  });

  it('drops near-stationary samples even after the interval', () => {
    expect(
      shouldAcceptUiSample(moved(1), 1_000 + policy.uiMinIntervalMs + 100, atOrigin(1_000), policy),
    ).toBe(false);
  });

  it('accepts moves from 40% of uiMinDistanceM once the interval has passed', () => {
    const later = 1_000 + policy.uiMinIntervalMs + 100;
    expect(shouldAcceptUiSample(moved(policy.uiMinDistanceM * 0.5), later, atOrigin(1_000), policy)).toBe(true);
    expect(shouldAcceptUiSample(moved(policy.uiMinDistanceM * 0.3), later, atOrigin(1_000), policy)).toBe(false);
  });
});

describe('shouldUploadSample', () => {
  const policy = locationPolicy(false, 'journey');

  it('accepts the first sample', () => {
    expect(shouldUploadSample(origin, 1_000, empty, policy)).toBe(true);
  });

  it('uploads after a large enough move and min interval', () => {
    expect(
      shouldUploadSample(
        moved(150),
        1_000 + policy.uploadMinIntervalMs,
        atOrigin(1_000),
        policy,
      ),
    ).toBe(true);
  });

  it('does not upload tiny moves before heartbeat', () => {
    expect(
      shouldUploadSample(moved(5), 1_000 + 1_000, atOrigin(1_000), policy),
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

  it('does not use the removed half-interval distance bypass', () => {
    expect(
      shouldUploadSample(
        moved(policy.uploadMinDistanceM * 3),
        1_000 + policy.uploadMinIntervalMs * 0.5,
        atOrigin(1_000),
        policy,
        'moving',
      ),
    ).toBe(false);
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
  const policy = locationPolicy(false, 'journey');

  it('recomputes on first sample', () => {
    expect(shouldRecomputeRoute(origin, 1_000, empty, policy)).toBe(true);
  });

  it('skips small moves', () => {
    expect(shouldRecomputeRoute(moved(5), 5_000, atOrigin(1_000), policy)).toBe(false);
  });

  it('recomputes only after the full route interval', () => {
    expect(
      shouldRecomputeRoute(
        moved(policy.routeMinDistanceM + 10),
        1_000 + policy.routeMinIntervalMs,
        atOrigin(1_000),
        policy,
      ),
    ).toBe(true);
  });
});

describe('virtual 30-minute journey request bounds', () => {
  function countUploads(policy: ReturnType<typeof locationPolicy>): number {
    let gate = empty;
    let requests = 0;
    for (let elapsedMs = 0; elapsedMs < 30 * 60_000; elapsedMs += 1_000) {
      const sample = moved(elapsedMs / 1_000 * 2);
      if (shouldUploadSample(sample, elapsedMs, gate, policy, 'moving')) {
        gate = { lastCoords: sample, lastAtMs: elapsedMs };
        requests += 1;
      }
    }
    return requests;
  }

  function countRoutes(policy: ReturnType<typeof locationPolicy>): number {
    let gate = empty;
    let requests = 0;
    for (let elapsedMs = 0; elapsedMs < 30 * 60_000; elapsedMs += 1_000) {
      const sample = moved(elapsedMs / 1_000 * 2);
      if (shouldRecomputeRoute(sample, elapsedMs, gate, policy)) {
        gate = { lastCoords: sample, lastAtMs: elapsedMs };
        requests += 1;
      }
    }
    return requests;
  }

  it('bounds normal moving uploads by the 60-second minimum', () => {
    const policy = locationPolicy(false, 'journey');
    expect(countUploads(policy)).toBeLessThanOrEqual(30 * 60 / 60);
    expect(countUploads(policy)).toBeGreaterThan(0);
  });

  it('bounds precise moving uploads by the 15-second minimum', () => {
    const policy = locationPolicy(true, 'journey');
    expect(countUploads(policy)).toBeLessThanOrEqual(30 * 60 / 15);
    expect(countUploads(policy)).toBeGreaterThan(0);
  });

  it('does not recalculate routes on every background/foreground fix', () => {
    const normal = countRoutes(locationPolicy(false, 'journey'));
    const precise = countRoutes(locationPolicy(true, 'journey'));
    expect(normal).toBeLessThanOrEqual(30 * 60 / 300);
    expect(precise).toBeLessThanOrEqual(30 * 60 / 36);
    expect(normal).toBeGreaterThan(0);
    expect(precise).toBeGreaterThan(0);
  });
});

describe('quantizeCoordinates', () => {
  it('rounds to the requested decimals', () => {
    expect(quantizeCoordinates({ latitude: 25.123456, longitude: 121.987654 }, 4)).toBe(
      '25.1235:121.9877',
    );
  });
});

 describe('automatic timing and near/far routes', () => {
   it('shares one automatic time scale while leaving the user one-shot bound separate', () => {
     expect(syncTimingScale(true, 'journey')).toBe(3);
     expect(syncTimingScale(false, 'journey')).toBe(6);
     expect(syncTimingScale(true, 'allDay')).toBe(2);
   });
   it.each([[true, true, 9_000, 15], [false, true, 18_000, 18],
     [true, false, 36_000, 20], [false, false, 300_000, 100]] as const)(
     'applies precise%s near%s route time and movement together', (precise, near, interval, distance) => {
       const policy = routeLocationPolicy(precise, near);
       expect(policy).toMatchObject({ routeMinIntervalMs: interval, routeMinDistanceM: distance });
       expect(shouldRecomputeRoute(moved(distance + 5), interval - 1, atOrigin(0), policy)).toBe(false);
       expect(shouldRecomputeRoute(moved(distance - 2), interval, atOrigin(0), policy)).toBe(false);
       expect(shouldRecomputeRoute(moved(distance + 5), interval, atOrigin(0), policy)).toBe(true);
     });
 });
