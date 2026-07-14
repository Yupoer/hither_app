import {
  ARRIVAL_RADIUS_M,
  ANCHOR_MAX_ACCURACY_M,
  gatedJourneyProgress,
  hasArrived,
  hasDepartedProgressStart,
  initialJourneyDistance,
  journeyProgress,
  progressStartRadiusM,
  sameMetricDistance,
  shouldAnchorInitial,
} from '../utils/journeyProgress';

describe('journey arrival boundary', () => {
  it.each([
    [29.99, true],
    [30, true],
    [30.01, false],
  ])('treats %s metres as arrived=%s', (distance, expected) => {
    expect(hasArrived(distance)).toBe(expected);
  });

  it('keeps the approved radius at exactly 30 metres', () => {
    expect(ARRIVAL_RADIUS_M).toBe(30);
  });
});

describe('personal journey progress', () => {
  it('prefers MapKit route distance for the initial distance', () => {
    expect(initialJourneyDistance(1200, 900)).toBe(1200);
  });

  it('falls back to straight-line distance when MapKit has no route', () => {
    expect(initialJourneyDistance(undefined, 900)).toBe(900);
  });

  it('uses the member own initial and current distance', () => {
    expect(journeyProgress(1000, 250)).toBeCloseTo(0.75);
  });

  it('clamps movement away from the destination to zero', () => {
    expect(journeyProgress(1000, 1200)).toBe(0);
  });

  it('clamps a passed destination to complete', () => {
    expect(journeyProgress(1000, -1)).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns zero for invalid initial distance %s',
    (initialDistance) => {
      expect(journeyProgress(initialDistance, 10)).toBe(0);
    },
  );
});

describe('progress start radius (short vs long trips)', () => {
  it('caps long trips at 40m so unlock is not delayed forever', () => {
    expect(progressStartRadiusM(2000)).toBe(40);
  });

  it('uses ~10% on mid-length trips', () => {
    expect(progressStartRadiusM(300)).toBe(30);
  });

  it('applies a 12m floor when the trip can afford it', () => {
    expect(progressStartRadiusM(100)).toBe(12);
  });

  it('shrinks the gate on short trips so progress is not stuck at 0%', () => {
    // 40m trip: 25% cap = 10m (no absolute 12m floor)
    expect(progressStartRadiusM(40)).toBe(4);
    expect(progressStartRadiusM(20)).toBe(2);
  });

  it('returns zero for invalid initial distances', () => {
    expect(progressStartRadiusM(0)).toBe(0);
    expect(progressStartRadiusM(Number.NaN)).toBe(0);
  });
});

describe('departed-start gate keeps progress at 0 until real movement', () => {
  it('stays at zero while still inside the start radius', () => {
    const { progress, departed } = gatedJourneyProgress({
      initialM: 1000,
      currentM: 870, // would be 13% without the gate
      movedFromStartM: 5,
    });
    expect(departed).toBe(false);
    expect(progress).toBe(0);
  });

  it('starts reporting remaining-distance progress after leaving the start radius', () => {
    const { progress, departed } = gatedJourneyProgress({
      initialM: 1000,
      currentM: 870,
      movedFromStartM: 40,
    });
    expect(departed).toBe(true);
    expect(progress).toBeCloseTo(0.13);
  });

  it('keeps calculating once departed even if user steps back toward start', () => {
    const { progress, departed } = gatedJourneyProgress({
      initialM: 1000,
      currentM: 800,
      movedFromStartM: 2,
      hasDepartedStart: true,
    });
    expect(departed).toBe(true);
    expect(progress).toBeCloseTo(0.2);
  });

  it('detects departure via helper', () => {
    expect(hasDepartedProgressStart(5, 1000)).toBe(false);
    expect(hasDepartedProgressStart(40, 1000)).toBe(true);
  });
});

describe('same-metric current distance', () => {
  it('keeps last route distance when live route is temporarily missing', () => {
    expect(sameMetricDistance('route', undefined, 900, 1500)).toBe(1500);
  });

  it('never falls back to straight-line while anchored on route', () => {
    expect(sameMetricDistance('route', undefined, 900, undefined)).toBeUndefined();
  });

  it('uses straight-line only for fallback-anchored journeys', () => {
    expect(sameMetricDistance('fallback', 1500, 900)).toBe(900);
  });

  it('prefers live route when available', () => {
    expect(sameMetricDistance('route', 1400, 900, 1500)).toBe(1400);
  });
});

describe('initial anchor requires device GPS', () => {
  it('rejects non-device coordinates', () => {
    expect(shouldAnchorInitial({ hasDeviceGps: false })).toBe(false);
  });

  it('accepts device GPS without accuracy metadata', () => {
    expect(shouldAnchorInitial({ hasDeviceGps: true, accuracyM: null })).toBe(true);
  });

  it('rejects poor accuracy fixes', () => {
    expect(
      shouldAnchorInitial({ hasDeviceGps: true, accuracyM: ANCHOR_MAX_ACCURACY_M + 1 }),
    ).toBe(false);
  });

  it('accepts accurate fixes', () => {
    expect(shouldAnchorInitial({ hasDeviceGps: true, accuracyM: 20 })).toBe(true);
  });
});
