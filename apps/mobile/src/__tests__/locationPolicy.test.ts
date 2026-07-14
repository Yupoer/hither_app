import {
  locationPolicy,
  quantizeCoordinates,
  shouldAcceptUiSample,
  shouldRecomputeRoute,
  shouldUploadSample,
  shouldWatchLocation,
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
  it('defaults to the low-power profile', () => {
    const p = locationPolicy(false);
    expect(p.accuracy).toBe('balanced');
    expect(p.distanceInterval).toBe(50);
    expect(p.timeInterval).toBe(20_000);
    expect(p.uploadMinDistanceM).toBe(50);
    expect(p.uploadHeartbeatMs).toBe(120_000);
    expect(p.routeCoordDecimals).toBe(4);
    expect(p.realtimeLocationDebounceMs).toBe(2_500);
  });

  it('uses the faster high-accuracy profile only when enabled', () => {
    const p = locationPolicy(true);
    expect(p.accuracy).toBe('high');
    expect(p.distanceInterval).toBe(8);
    expect(p.timeInterval).toBe(5_000);
    expect(p.uploadMinDistanceM).toBe(15);
    expect(p.uploadHeartbeatMs).toBe(45_000);
    expect(p.routeCoordDecimals).toBe(5);
    expect(p.realtimeLocationDebounceMs).toBe(1_500);
  });
});

describe('shouldWatchLocation', () => {
  it('watches only for an active app with a group', () => {
    expect(shouldWatchLocation('group-1', 'active')).toBe(true);
    expect(shouldWatchLocation('group-1', 'background')).toBe(false);
    expect(shouldWatchLocation('group-1', 'inactive')).toBe(false);
    expect(shouldWatchLocation(null, 'active')).toBe(false);
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

  it('uploads on heartbeat while nearly stationary', () => {
    expect(
      shouldUploadSample(
        moved(1),
        1_000 + policy.uploadHeartbeatMs,
        atOrigin(1_000),
        policy,
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
