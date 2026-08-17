import { personalDisplayProgress } from '../utils/journeyProgress';
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

  it('caps pre-arrival progress at 95% even when remaining distance is tiny', () => {
    // 10m remaining of 1000m → raw 99%, must clamp to 0.95 until arrival
    const nearDone = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 10,
    });
    expect(nearDone.arrived).toBe(false);
    expect(nearDone.progress).toBeLessThanOrEqual(0.95);
    expect(nearDone.progress).toBeCloseTo(0.95);
  });

  it('reaches 100% only on confirmed arrival', () => {
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
  });

  it('never decreases progress for the same destination (monotonic max)', () => {
    const later = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 800, // raw progress 0.2
      previousProgressMax: 0.55,
    });
    expect(later.progress).toBeCloseTo(0.55);
  });

  it('resets progress baseline when previousProgressMax is cleared for new destination', () => {
    const model = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 700,
      previousProgressMax: null,
    });
    expect(model.progress).toBeCloseTo(0.3);
  });

  it('estimates remaining from GPS move between throttled route results', () => {
    // Anchor remaining 1000m at origin; move toward target by ~half the straight span.
    const model = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: null, // no fresh route this sample
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000,
    });
    expect(model.distanceMeters).not.toBeNull();
    expect(model.distanceMeters!).toBeLessThan(1000);
    expect(model.distanceMeters!).toBeGreaterThanOrEqual(0);
  });

  it('uses GPS local estimate when routeDistanceM is still a finite stale result (#145 Sol)', () => {
    // Production keeps sticky selfRoute.distanceMeters between throttled requests.
    // Two accepted GPS samples with the same finite route remaining must move.
    const atAnchor = derivePersonalProgress({
      deviceCoords: origin,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 1000,
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000,
      routeEtaSeconds: 900,
    });
    const afterMove = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 1000, // still finite, same stale route sample
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000,
      routeEtaSeconds: 900,
    });
    expect(atAnchor.distanceMeters).toBe(1000);
    expect(afterMove.distanceMeters).not.toBeNull();
    expect(afterMove.distanceMeters!).toBeLessThan(1000);
    expect(afterMove.distanceMeters!).toBeGreaterThanOrEqual(0);
    // ETA must follow the local remaining, not the stale route ETA.
    expect(afterMove.etaSeconds).not.toBe(900);
    expect(afterMove.etaSeconds!).toBeLessThan(900);
  });

  it('corrects to fresh route result when available (overrides local estimate)', () => {
    const model = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 420,
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000,
    });
    expect(model.distanceMeters).toBe(420);
  });

  it('snaps on new route generation even when remaining metres are equal (#145 Sol)', () => {
    // Two distinct directions results can return the same integer remaining.
    // Generation (not distance equality) marks freshness; snap + new ETA win.
    const afterMoveLocal = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 1000,
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000,
      routeResultGeneration: 1,
      routeAnchorGeneration: 1,
      routeEtaSeconds: 900,
    });
    expect(afterMoveLocal.distanceMeters!).toBeLessThan(1000);

    const afterEqualDistanceResult = derivePersonalProgress({
      deviceCoords: nearTarget,
      targetCoords: atTarget,
      initialDistanceM: 2000,
      hasDepartedStart: true,
      travelMode: 'walk',
      distanceSource: 'route',
      routeDistanceM: 1000, // same metres as prior result
      lastRouteDistanceM: 1000,
      routeAnchorGps: origin,
      routeAnchorRemainingM: 1000, // not yet re-anchored
      routeResultGeneration: 2, // new directions completion
      routeAnchorGeneration: 1,
      routeEtaSeconds: 720, // new ETA for new routed origin
    });
    expect(afterEqualDistanceResult.distanceMeters).toBe(1000);
    expect(afterEqualDistanceResult.etaSeconds).toBe(720);
  });

  it('retains last valid distance/ETA/progress when GPS is missing', () => {
    const model = derivePersonalProgress({
      deviceCoords: null,
      targetCoords: atTarget,
      initialDistanceM: 1000,
      hasDepartedStart: true,
      travelMode: 'walk',
      lastValidDistanceM: 640,
      lastValidEtaSeconds: 480,
      lastValidProgress: 0.4,
    });
    expect(model.distanceMeters).toBe(640);
    expect(model.etaSeconds).toBe(480);
    expect(model.progress).toBeCloseTo(0.4);
    expect(model.freshness).toBe('stale');
    expect(model.arrived).toBe(false);
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
    expect(map).toContain('usePersonalProgressSurfaces');
    expect(map).toContain('progressSurfaces.gatheringCard');
    expect(map).toContain('progressSurfaces.liveActivityPayload');
    expect(map).toContain('personalDistanceM');
    expect(map).toContain('personalEtaSeconds');
    expect(map).toContain('personalProgressRatio');
    // Live Activity + passive consume the shared fields.
    expect(map).toContain('distanceMeters: progressSurfaces.liveActivityPayload.distanceMeters');
    expect(map).toContain('etaSeconds: progressSurfaces.liveActivityPayload.etaSeconds');
    expect(map).toContain('progress: progressSurfaces.liveActivityPayload.progress');
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
    // #145: GPS-between-route estimate, monotonic max, last-valid retention.
    expect(map).toContain('previousProgressMax');
    expect(map).toContain('lastValidDistanceM');
    // Anchor only on new route result — not every deviceCoords tick.
    // Generation identity, not distance equality, marks a fresh result (#145).
    expect(map).toContain('selfRouteGeneration');
    expect(map).toContain('routeResultGeneration');
    // Markers use team completion, not personal arrivals.
    expect(map).toContain('completedDestinationIds={teamCompletedDestinationIds}');
    // Target pulse only while journey is active with a nav target.
    expect(map).toContain('journeyActive && navTarget?.id ? navTarget.id : null');
  });
});

describe('personalDisplayProgress (#194 A3/A4)', () => {
  it('uses gated walking remaining, not ungated 1-current/initial', () => {
    const ungated = 1 - 870 / 1000;
    expect(ungated).toBeCloseTo(0.13);
    expect(
      personalDisplayProgress({
        initialM: 1000,
        currentM: 870,
        movedFromStartM: 5,
      }),
    ).toBe(0);
    expect(
      personalDisplayProgress({
        initialM: 1000,
        currentM: 870,
        movedFromStartM: 40,
      }),
    ).toBeCloseTo(0.13);
  });

  it('resets sticky max when the destination id changes', () => {
    const walking = personalDisplayProgress({
      initialM: 1000,
      currentM: 400,
      movedFromStartM: 80,
      previousMax: 0.2,
    });
    expect(walking).toBeCloseTo(0.6);
    expect(
      personalDisplayProgress({
        initialM: 2000,
        currentM: 1980,
        movedFromStartM: 5,
        previousMax: 0,
        destinationId: 'dest-b',
        previousDestinationId: 'dest-a',
      }),
    ).toBe(0);
  });

  it('caps pre-arrival progress at 95% until arrived', () => {
    expect(
      personalDisplayProgress({
        initialM: 1000,
        currentM: 10,
        movedFromStartM: 200,
        hasDepartedStart: true,
      }),
    ).toBe(0.95);
    expect(
      personalDisplayProgress({
        initialM: 1000,
        currentM: 10,
        movedFromStartM: 200,
        hasDepartedStart: true,
        arrived: true,
      }),
    ).toBe(1);
  });
});
