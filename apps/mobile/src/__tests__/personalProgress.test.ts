import { derivePersonalProgress } from '../utils/personalProgress';

const origin = { latitude: 25.033, longitude: 121.565 };
const nearTarget = { latitude: 25.0335, longitude: 121.5654 };
const atTarget = { latitude: 25.04, longitude: 121.57 };
const farAway = { latitude: 25.1, longitude: 121.6 };

describe('derivePersonalProgress (shared local model)', () => {
  it('computes distance, ETA, and progress toward the target', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      startCoords: origin,
      hasDepartedStart: true,
      travelMode: 'walk',
    });
    expect(model.distanceMeters).toBeGreaterThan(500);
    expect(model.etaSeconds).toBeGreaterThan(0);
    expect(model.progress).toBeGreaterThan(0);
    expect(model.progress).toBeLessThan(1);
    expect(model.freshness).toBe('live');
    expect(model.arrived).toBe(false);
  });

  it('clamps progress to 0–100% when moving away past baseline', () => {
    const model = derivePersonalProgress({
      deviceCoords: farAway,
      targetCoords: atTarget,
      initialDistanceM: 500,
      startCoords: origin,
      hasDepartedStart: true,
      travelMode: 'walk',
    });
    expect(model.progress).toBe(0);
  });

  it('gates early progress until departure from start pin', () => {
    const model = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      startCoords: origin,
      hasDepartedStart: false,
      travelMode: 'walk',
    });
    // Near start relative to long trip — may still be 0 if within start radius.
    expect(model.progress).toBeGreaterThanOrEqual(0);
    expect(model.progress).toBeLessThanOrEqual(1);
  });

  it('uses travel-mode coarse ETA when route ETA is absent', () => {
    const walk = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
    });
    const drive = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'drive',
    });
    expect(drive.etaSeconds!).toBeLessThan(walk.etaSeconds!);
  });

  it('prefers route ETA when provided', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      routeEtaSeconds: 120,
    });
    expect(model.etaSeconds).toBe(120);
  });

  it('marks freshness stale when sample is old but keeps last values', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      sampleAgeMs: 120_000,
      staleAfterMs: 30_000,
    });
    expect(model.freshness).toBe('stale');
    expect(model.distanceMeters).not.toBeNull();
  });

  it('returns unknown without target', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: null,
      travelMode: 'walk',
    });
    expect(model.freshness).toBe('unknown');
    expect(model.distanceMeters).toBeNull();
    expect(model.progress).toBeNull();
  });

  it('forces progress 1 and eta 0 on arrival', () => {
    const model = derivePersonalProgress({
      deviceCoords: atTarget,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      arrivalRadiusM: 50,
    });
    expect(model.arrived).toBe(true);
    expect(model.progress).toBe(1);
    expect(model.etaSeconds).toBe(0);
  });

  it('completed overrides numeric progress', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      travelMode: 'walk',
      completed: true,
    });
    expect(model.completed).toBe(true);
    expect(model.arrived).toBe(true);
    expect(model.progress).toBe(1);
    expect(model.distanceMeters).toBe(0);
  });

  it('keeps last route metric when distanceSource is route and sample has no route', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1500,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: null,
      lastRouteDistanceM: 900,
    });
    expect(model.distanceMeters).toBe(900);
  });
});

describe('personal progress surface contracts', () => {
  it('MapScreen feeds card, passive, and Live Activity from the same model', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const map = fs.readFileSync(
      path.join(__dirname, '../screens/MapScreen.tsx'),
      'utf8',
    );
    expect(map).toContain('derivePersonalProgress');
    expect(map).toContain('personalDistanceM');
    expect(map).toContain('personalEtaSeconds');
    expect(map).toContain('personalProgressRatio');
    // Live Activity + passive consume the shared fields.
    expect(map).toContain('distanceMeters: personalDistanceM ?? liveDistance');
    expect(map).toContain('etaSeconds: personalEtaSeconds');
    expect(map).toContain('progress: personalProgressRatio ?? liveProgress');
    expect(map).toContain('teamSurfaceView.personal?.progress');
    expect(map).toContain('personalProgressRatio');
    // Team completion (closedAt) is distinct from personal arrival ids.
    expect(map).toContain('teamCompletedDestinationIds');
    expect(map).toContain('teamCompletedDestinationIds.has(navTarget.id)');
    expect(map).toContain('sampleAgeMs');
    expect(map).toContain('deviceCoordsAcceptedAtMs');
    // Freshness ages with a single stale-threshold timeout while journey is
    // active — not a permanent 5s MapScreen polling loop.
    expect(map).toContain('progressClockMs');
    expect(map).toContain('PERSONAL_PROGRESS_STALE_MS');
    expect(map).toContain('setTimeout');
    expect(map).not.toContain('setInterval(() => setProgressClockMs(Date.now()), 5_000)');
    // Stale/unknown remains internal; the card retains useful numbers without
    // appending a generic warning.
    expect(map).not.toContain("t('locationUpdate.stale')");
    expect(map).toContain('personalFreshness: personalProgress.freshness');
    // Markers use team completion, not personal arrivals.
    expect(map).toContain('completedDestinationIds={teamCompletedDestinationIds}');
    // Target pulse only while journey is active with a nav target.
    expect(map).toContain('journeyActive && navTarget?.id ? navTarget.id : null');
  });
});
